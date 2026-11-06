// The page's network counted from its first request on (net-activity.ts): imported first by main.ts, before any module that
// fetches is evaluated.
import { installNetActivity } from "./system/net-activity";

installNetActivity("page");
