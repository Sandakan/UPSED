#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsServer.h>

void ensureNetworkServicesStarted();
bool connectToWifi(const String& ssid, const String& pass, uint32_t timeoutMs);
bool connectToWifiWithRollback(const String& newSsid, const String& newPass,
                               const String& prevSsid, const String& prevPass, uint32_t timeoutMs);
void onWebSocketEvent(uint8_t clientNum, WStype_t type, uint8_t* payload, size_t length);
void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info);
