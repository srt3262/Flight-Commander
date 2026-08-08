# DroneCAN moving-baseline provisioning

Flight Commander 4.0.0 includes a non-redundant dynamic node-ID allocator. AP_Periph modules with `CAN_NODE=0` receive temporary unique IDs automatically. The moving-baseline manager then identifies the selected modules, writes those IDs back to `CAN_NODE`, assigns `GPS_TYPE=17` and `GPS_TYPE=18`, saves, restarts, and verifies the pair.
