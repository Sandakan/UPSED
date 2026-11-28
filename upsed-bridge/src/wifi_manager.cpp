#include "wifi_manager.h"
#include "bridge_state.h"
#include "ota_manager.h"
#include "rpc_handler.h"

#include <ESPmDNS.h>
#include <time.h>

void ensureNetworkServicesStarted() {
    if (WiFi.status() == WL_CONNECTED) {
        if (!mdnsStarted) {
            if (MDNS.begin(BRIDGE_MDNS_HOSTNAME)) {
                MDNS.addService("ws", "tcp", BRIDGE_WS_PORT);
                mdnsStarted = true;
                diagLog.info("[MDNS] Started responder: ws://%s.local:%d", BRIDGE_MDNS_HOSTNAME, BRIDGE_WS_PORT);
            }
        }
        if (!wsServerStarted) {
            wsServer.begin();
            wsServerStarted = true;
            diagLog.info("[WS] WebSocket server listening on port %d", BRIDGE_WS_PORT);
        }
        initArduinoOta();
        if (!ntpStarted) {
            configTime(bridgeClock.tzOffsetMin() * 60, 0, "pool.ntp.org", "time.nist.gov", "time.google.com");
            ntpStarted = true;
            diagLog.info("[NTP] SNTP client initialized (offset: %d min, pool.ntp.org, time.nist.gov, time.google.com)",
                         bridgeClock.tzOffsetMin());
        }
    }
}

bool connectToWifi(const String& ssid, const String& pass, uint32_t timeoutMs) {
    if (ssid.length() == 0) {
        ledController.setWifiState(WIFI_LED_DISCONNECTED);
        return false;
    }

    ledController.setWifiState(WIFI_LED_CONNECTING);
    diagLog.info("[WIFI] Associating with 2.4GHz network '%s'...", ssid.c_str());
    WiFi.mode(WIFI_STA);
    WiFi.setTxPower(WIFI_POWER_15dBm);
    WiFi.setHostname(BRIDGE_MDNS_HOSTNAME);
    WiFi.disconnect(false, true);
    WiFi.begin(ssid.c_str(), pass.c_str());

    unsigned long startMs = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - startMs) < timeoutMs) {
        delay(50);
        ledController.update();
    }

    if (WiFi.status() == WL_CONNECTED) {
        lastWifiError = "None";
        ledController.setWifiState(WIFI_LED_CONNECTED);
        ensureNetworkServicesStarted();
        return true;
    }

    ledController.setWifiState(WIFI_LED_DISCONNECTED);
    return false;
}

bool connectToWifiWithRollback(const String& newSsid, const String& newPass,
                               const String& prevSsid, const String& prevPass, uint32_t timeoutMs) {
    ledController.setWifiState(WIFI_LED_CONNECTING);
    diagLog.info("[WIFI] Attempting connection to new network '%s'...", newSsid.c_str());

    WiFi.mode(WIFI_STA);
    WiFi.setTxPower(WIFI_POWER_15dBm);
    WiFi.setHostname(BRIDGE_MDNS_HOSTNAME);
    WiFi.disconnect(false, true);
    delay(50);
    WiFi.begin(newSsid.c_str(), newPass.c_str());

    unsigned long startMs = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - startMs) < timeoutMs) {
        delay(50);
        ledController.update();
    }

    if (WiFi.status() == WL_CONNECTED) {
        lastWifiError = "None";
        ledController.setWifiState(WIFI_LED_CONNECTED);
        diagLog.info("[WIFI] Successfully switched to '%s' (IP: %s)",
                     newSsid.c_str(), WiFi.localIP().toString().c_str());
        if (mdnsStarted) {
            MDNS.end();
            mdnsStarted = false;
        }
        ensureNetworkServicesStarted();
        return true;
    }

    diagLog.warn("[WIFI] Connection to '%s' failed! Error: %s",
                 newSsid.c_str(), lastWifiError.c_str());

    if (prevSsid.length() > 0 && prevSsid != newSsid) {
        diagLog.warn("[WIFI] Rolling back NVS credentials to previous network '%s'...", prevSsid.c_str());
        prefs.begin("upsed-wifi", false);
        prefs.putString("ssid", prevSsid);
        prefs.putString("pass", prevPass);
        prefs.end();
        savedSsid = prevSsid;
        savedPass = prevPass;

        WiFi.disconnect(false, true);
        delay(50);
        WiFi.begin(prevSsid.c_str(), prevPass.c_str());

        startMs = millis();
        while (WiFi.status() != WL_CONNECTED && (millis() - startMs) < 10000) {
            delay(50);
            ledController.update();
        }

        if (WiFi.status() == WL_CONNECTED) {
            ledController.setWifiState(WIFI_LED_CONNECTED);
            diagLog.info("[WIFI] Rollback successful! Reconnected to '%s' (IP: %s)",
                         prevSsid.c_str(), WiFi.localIP().toString().c_str());
            if (mdnsStarted) {
                MDNS.end();
                mdnsStarted = false;
            }
            ensureNetworkServicesStarted();
            return false;
        } else {
            ledController.setWifiState(WIFI_LED_DISCONNECTED);
            diagLog.error("[WIFI] Rollback connection to '%s' also failed! (error: %s)",
                          prevSsid.c_str(), lastWifiError.c_str());
        }
    } else {
        diagLog.warn("[WIFI] No previous rollback credentials available.");
    }

    return false;
}

void onWebSocketEvent(uint8_t clientNum, WStype_t type, uint8_t* payload, size_t length) {
    if (type == WStype_CONNECTED) {
        IPAddress ip = wsServer.remoteIP(clientNum);
        diagLog.info("[WS] Client #%u connected from %s", clientNum, ip.toString().c_str());
        if (clientNum < BRIDGE_MAX_WS_CLIENTS) {
            wsClients[clientNum].active = true;
            wsClients[clientNum].clientNum = clientNum;
            wsClients[clientNum].ip = ip.toString();
            wsClients[clientNum].connectedMs = millis();
            wsClients[clientNum].lastSeenMs = millis();
            wsClients[clientNum].reqCount = 0;
        }
        broadcastBridgeStatusChanged("ws_connected");
    } else if (type == WStype_DISCONNECTED) {
        diagLog.info("[WS] Client #%u disconnected", clientNum);
        if (clientNum < BRIDGE_MAX_WS_CLIENTS) {
            wsClients[clientNum].active = false;
        }
        broadcastBridgeStatusChanged("ws_disconnected");
    } else if (type == WStype_TEXT && payload != nullptr && length > 0) {
        if (clientNum < BRIDGE_MAX_WS_CLIENTS) {
            wsClients[clientNum].lastSeenMs = millis();
            wsClients[clientNum].reqCount++;
        }
        String reqStr = String(reinterpret_cast<const char*>(payload), length);
        reqStr.trim();
        if (reqStr.length() > 0) {
            String resStr;
            handleJsonRpcRequest(reqStr, resStr, clientNum);
            wsServer.sendTXT(clientNum, resStr);
        }
    }
}

void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
    switch (event) {
        case ARDUINO_EVENT_WIFI_STA_CONNECTED:
            ledController.setWifiState(WIFI_LED_CONNECTING);
            diagLog.info("[WIFI] Connected to AP '%s' (BSSID %02X:%02X:%02X:%02X:%02X:%02X)",
                         WiFi.SSID().c_str(),
                         info.wifi_sta_connected.bssid[0], info.wifi_sta_connected.bssid[1],
                         info.wifi_sta_connected.bssid[2], info.wifi_sta_connected.bssid[3],
                         info.wifi_sta_connected.bssid[4], info.wifi_sta_connected.bssid[5]);
            break;
        case ARDUINO_EVENT_WIFI_STA_GOT_IP:
            ledController.setWifiState(WIFI_LED_CONNECTED);
            diagLog.info("[WIFI] DHCP IP Assigned: %s (Gateway: %s, RSSI: %d dBm)",
                         WiFi.localIP().toString().c_str(),
                         WiFi.gatewayIP().toString().c_str(),
                         WiFi.RSSI());
            lastWifiError = "None";
            ensureNetworkServicesStarted();
            broadcastBridgeStatusChanged("wifi_got_ip");
            break;
        case ARDUINO_EVENT_WIFI_STA_DISCONNECTED: {
            ntpStarted = false;
            uint8_t reason = info.wifi_sta_disconnected.reason;
            lastWifiError = String(DiagLogger::wifiReasonToString(reason));
            if (reason == WIFI_REASON_AUTH_EXPIRE || reason == WIFI_REASON_AUTH_FAIL ||
                reason == WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT || reason == WIFI_REASON_HANDSHAKE_TIMEOUT) {
                ledController.setWifiState(WIFI_LED_AUTH_FAIL);
            } else {
                ledController.setWifiState(WIFI_LED_DISCONNECTED);
            }
            diagLog.warn("[WIFI] Disconnected from AP: %s (Reason code %d)",
                         lastWifiError.c_str(), reason);
            broadcastBridgeStatusChanged("wifi_disconnected");
            break;
        }
        default:
            break;
    }
}
