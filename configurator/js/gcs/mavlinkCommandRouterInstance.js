"use strict";

import mavlinkSession from "../mavlink/mavlinkSession.js";
import { MavlinkCommandRouter } from "./mavlinkCommandRouter.js";

export const mavlinkCommandRouter = new MavlinkCommandRouter(mavlinkSession);

export default mavlinkCommandRouter;
