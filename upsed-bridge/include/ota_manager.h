#pragma once

#include <Arduino.h>

void startOtaMode();
void stopOtaMode();
void beginPendingOtaApproval();
void initArduinoOta();
void handleOtaLoop();
