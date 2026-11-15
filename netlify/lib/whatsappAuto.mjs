import { sendMessage } from "./whatsappSender.mjs";

/**
 * Sending a WhatsApp message as a side effect of something else.
 *
 * THIS CAN NEVER FAIL THE THING THAT CAUSED IT. A quotation has been
 * emailed, an order has been delivered, a payment has been banked — those
 * happened, and they stay happened whether or not Meta accepted a message
 * about them. Every path out of here returns; nothing throws. A refusal and
 * a crash are both written to the log and swallowed.
 *
 * It is also deliberately NOT awaited by some callers: the browser should not
 * wait on Meta to be told its own work is saved. Where it is awaited, it is
 * because the response reports what happened, never because the outcome
 * depends on it.
 *
 * WHAT IT DOES NOT DECIDE: whether the customer agreed, and whether this
 * message is switched on. `sendMessage` asks both, every time, and an
 * automatic message is refused when the switch is off — which is how all
 * eight start out.
 */
export async function notifyOnWhatsApp(admin, args) {
  const label = `${args?.template ?? "?"} ${args?.recordType ?? ""}${args?.recordId ? ` ${args.recordId}` : ""}`;
  try {
    const result = await sendMessage(admin, { ...args, manual: false });
    if (!result?.ok && !result?.alreadySent) {
      /* Not an error anybody needs to see: "the switch is off" and "they
         have not agreed" are the normal answers. */
      console.log("whatsapp: not sent —", label, "—", result?.reason ?? "no reason given");
    }
    return result ?? { ok: false, reason: "Nothing came back from the sender." };
  } catch (err) {
    console.error("whatsapp: failed —", label, "—", err?.message ?? err);
    return { ok: false, reason: "The WhatsApp message could not be sent." };
  }
}
