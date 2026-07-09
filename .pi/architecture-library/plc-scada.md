---
name: plc-scada
domain: industrial-automation, manufacturing, process-control
team-size: small-to-medium
complexity: medium-to-high
best-for-drivers:
  - industrial control
  - real-time control
  - safety critical
  - deterministic timing
  - plc programming
  - scada supervision
not-for-drivers:
  - general web application
  - cloud native scaling
  - frequent deployment
  - microservices
source: community
---

# PLC / SCADA Industrial Control Architecture

Architecture for industrial automation using Programmable Logic Controllers (PLCs) and Supervisory Control and Data Acquisition (SCADA) systems.

## When to use

- The project controls physical machines or processes.
- Deterministic real-time control is required.
- Safety or regulatory compliance is critical.
- The system must operate reliably in harsh environments.
- PLC programming is the primary development task.

## When not to use

- The project is a general-purpose web or mobile app.
- Frequent deployment is needed.
- Cloud-native scalability is the main goal.
- The team has no industrial automation experience.

## Core rules

1. Separate control logic (PLC) from supervision (SCADA/HMI).
2. Use deterministic scan cycles for PLC code.
3. Implement safety interlocks at the PLC level, not only in SCADA.
4. Log all critical events and alarms.
5. Design for remote monitoring and maintenance.
6. Follow IEC 61131-3 standards for PLC code.
7. Keep OT (operational technology) network segmented from IT network.

## Typical structure

```
project/
  plc/
    main.st
    safety.st
    io-config.cfg
  scada/
    screens/
    alarms/
    trends/
  docs/
    wiring-diagrams/
    io-list.csv
```

## Common pitfalls

- Putting safety logic only in SCADA.
- Allowing IT network traffic into the OT network.
- Hardcoding device addresses without documentation.
- Ignoring cycle time limits.

## Standards and tools

- IEC 61131-3
- OPC UA for communication
- Modbus, Profinet, EtherNet/IP
- Tools: Siemens TIA Portal, Rockwell Studio 5000, Schneider EcoStruxure, CODESYS
