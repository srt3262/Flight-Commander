"use strict";

import mavlinkSession from "../mavlink/mavlinkSession.js";
import {
  MavlinkCommandRouter,
  inavMavlinkProfileStore,
} from "./mavlinkCommandRouter.js";

export { inavMavlinkProfileStore };

export const mavlinkCommandRouter = new MavlinkCommandRouter(mavlinkSession, {
  profileStore: inavMavlinkProfileStore,
});

export default mavlinkCommandRouter;
