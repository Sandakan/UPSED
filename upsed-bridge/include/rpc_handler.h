#pragma once

#include <Arduino.h>

void handleJsonRpcRequest(const String& jsonLine, String& jsonResponseOut, int clientNum = -1);
