"use strict";

import mavlinkSession from "../mavlink/mavlinkSession.js";
import {
  MavlinkCommandRouter,
  inavMavlinkProfileStore,
  resolveCachedFlightCommanderIdentity,
} from "./mavlinkCommandRouter.js";

export { inavMavlinkProfileStore };

mavlinkSession.setFlightCommanderIdentityResolver((state) =>
  resolveCachedFlightCommanderIdentity(inavMavlinkProfileStore, state),
);

export const mavlinkCommandRouter = new MavlinkCommandRouter(mavlinkSession, {
  profileStore: inavMavlinkProfileStore,
});

export default mavlinkCommandRouter;
