import { app } from "@azure/functions";
import { register } from "./register.mjs";

/* The entry point the Functions host loads. Everything it does is in
   `register.mjs`, which is testable without the host. */
register(app);
