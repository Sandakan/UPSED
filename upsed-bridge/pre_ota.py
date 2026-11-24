Import("env")
import os
import sys
from pathlib import Path

# Resolve UPSED_OTA_SECRET from system environment or root .env file
secret = os.environ.get("UPSED_OTA_SECRET")
if not secret:
    root_env = Path(env.get("PROJECT_DIR")).parent / ".env"
    if root_env.exists():
        try:
            with open(root_env, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("UPSED_OTA_SECRET="):
                        secret = line.split("=", 1)[1].strip("'\" \t\r\n")
                        break
        except Exception:
            pass

if not secret:
    secret = "upsed-ota-default-secret"

# 1. Inject into C++ compiler preprocessor definitions for all builds
# SCons uses '$' for variable substitution; escape '$' as '$$' to prevent variable expansion
scons_escaped_secret = secret.replace("$", "$$")
env.Append(CPPDEFINES=[("BRIDGE_OTA_SECRET", f'\\"{scons_escaped_secret}\\"')])

# 2. Inject into UPLOAD_FLAGS and register custom uploader ONLY for espota protocol
if env.get("UPLOAD_PROTOCOL") == "espota":
    current_flags = env.get("UPLOAD_FLAGS", [])
    if isinstance(current_flags, str):
        current_flags = current_flags.split()
    elif isinstance(current_flags, tuple):
        current_flags = list(current_flags)

    new_flags = [f for f in current_flags if not f.startswith("--auth")]
    new_flags.append(f"--auth={scons_escaped_secret}")
    env.Replace(UPLOAD_FLAGS=new_flags)

    # 3. Smart OTA Upload Wrapper with Factory Fallback
    def custom_ota_upload(target, source, env):
        import subprocess
        uploader = env.subst("$UPLOADER")
        python_exe = sys.executable or env.subst("$PYTHONEXE")
        source_file = str(source[0])
        upload_port = env.subst("$UPLOAD_PORT") or "upsed-bridge.local"

        cmd_base = [python_exe, uploader, "-i", upload_port, "-p", "3232", "-f", source_file]

        # Attempt 1: Configured secret from .env
        print(f"\n[OTA] Attempting upload to {upload_port} with configured secret ({secret[:4]}***)...")
        res = subprocess.run(cmd_base + ["-a", secret])
        if res.returncode == 0:
            return 0

        # Attempt 2: Fallback to default factory secret if configured secret failed and differs
        if secret != "upsed-ota-default-secret":
            print("\n[OTA] Configured secret authentication failed. Retrying with default factory secret...")
            res2 = subprocess.run(cmd_base + ["-a", "upsed-ota-default-secret"])
            if res2.returncode == 0:
                print("[OTA] Successfully flashed firmware using factory fallback! Device will now boot with your configured secret.")
                return 0

        return res.returncode

    env.Replace(UPLOADCMD=custom_ota_upload)
