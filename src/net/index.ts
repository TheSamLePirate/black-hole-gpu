// The network's module, built on its own as net.js (server.ts, scripts/build-pages.ts) and loaded only when
// the player asks for the network (src/net/load.ts): the solo game neither downloads nor runs a line of it.

export { NetClient, type NetIdentity, type NetOptions, type NetStatus, type Room } from "./client";
export { NetClock } from "./clock";
export * as proto from "./proto";
export { RemoteRegistry, RemoteTrack, type CraftState } from "./remote";
export { parseLab, type LabSettings } from "./transport";
