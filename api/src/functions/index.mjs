import { app } from "@azure/functions";
import { register } from "./register.mjs";
import { registerNetlifyFunctions } from "./netlifyBridge.mjs";

/* The entry point the Functions host loads.
   `/api/q` and `/api/rpc` are the browser's data layer; the rest are the
   twenty-six handlers that came across from Netlify. Everything either one
   does lives in a module that can be tested without the host. */
register(app);
registerNetlifyFunctions(app);
