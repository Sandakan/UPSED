#pragma once

#include <Arduino.h>

String executeUpsCommand(const String& rawCmd, bool isStandalonePoll = false);
