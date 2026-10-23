Import("env")
import os
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

# Ensure environment variable is set
os.environ["UPSED_OTA_SECRET"] = secret

# PlatformIO espressif32 builder uses UPLOAD_FLAGS for espota command line
current_flags = env.get("UPLOAD_FLAGS", [])
if isinstance(current_flags, str):
    current_flags = current_flags.split()
elif isinstance(current_flags, tuple):
    current_flags = list(current_flags)

# Strip any existing --auth argument and add the resolved secret dynamically
new_flags = [f for f in current_flags if not f.startswith("--auth")]
new_flags.append(f"--auth={secret}")

env.Replace(UPLOAD_FLAGS=new_flags)
