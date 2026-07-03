---
name: embedded-iot
domain: embedded, iot, firmware, edge
team-size: small-to-medium
complexity: medium-to-high
best-for-drivers:
  - constrained hardware
  - real-time constraints
  - edge computing
  - sensor data
  - low power
  - firmware development
not-for-drivers:
  - rich user interface
  - general purpose computing
  - easy scaling
  - rapid feature iteration
source: community
---

# Embedded / IoT Architecture

Architecture for devices with limited resources that interact with sensors, actuators, and cloud services.

## When to use

- The project runs on constrained hardware (microcontrollers, single-board computers).
- Real-time or near-real-time response is required.
- The device must operate with low power.
- Sensors and actuators are central to the system.
- Edge processing is needed before sending data to the cloud.

## When not to use

- A rich desktop or web UI is the main product.
- General-purpose computing and rapid iteration are needed.
- The team has no embedded or hardware experience.

## Core rules

1. Keep firmware modular and portable.
2. Minimize memory and CPU usage.
3. Handle hardware failures gracefully.
4. Use efficient communication protocols (MQTT, CoAP, LoRaWAN).
5. Secure the device: encryption, secure boot, OTA updates.
6. Balance edge processing with cloud offloading.
7. Plan for power management and sleep modes.

## Typical structure

```
project/
  firmware/
    drivers/
    hal/
    application/
    middleware/
  cloud/
    ingestion/
    analytics/
  mobile/
    companion-app/
```

## Common pitfalls

- Ignoring memory constraints.
- Blocking the main loop with long operations.
- Insecure default credentials.
- No OTA update mechanism.
- Sending too much raw data to the cloud.

## Common technologies

- FreeRTOS, Zephyr, Arduino, ESP-IDF
- MQTT, CoAP, HTTP/2
- Raspberry Pi, ESP32, STM32
