// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "../../components/Toast";
import { WhatsAppDialog } from "./WhatsAppDialog";
import { IntegrationError, type IntegrationsApi } from "../../integrations/api";

/**
 * A quotation sent on WhatsApp has to come back as "Sent" by itself.
 *
 * Until this wiring existed, the ONLY route that recorded a send was the
 * email dialog — so a salesperson who used WhatsApp, which most of them do,
 * left the document reading "Draft" and set it by hand afterwards. These
 * tests pin the two halves of that promise, and the line between them:
 * the provider taking the message is a send; wa.me opening a browser tab
 * is not, because the person still has to press send inside WhatsApp.
 */

const api = (sendWhatsApp: IntegrationsApi["sendWhatsApp"]) =>
  ({ sendWhatsApp } as unknown as IntegrationsApi);

function show(props: Partial<Parameters<typeof WhatsAppDialog>[0]> & { api: IntegrationsApi }) {
  return render(
    <ToastProvider>
      <WhatsAppDialog
        open
        defaultPhone="+91 98100 12345"
        defaultMessage="Please find attached Quotation TZ/QT/2026-27/0042."
        onClose={() => {}}
        {...props}
      />
    </ToastProvider>,
  );
}

afterEach(cleanup);

describe("sending a document on WhatsApp", () => {
  it("reports the send once the provider has taken the message", async () => {
    const onSent = vi.fn();
    show({ api: api(async () => {}), onSent });

    screen.getByRole("button", { name: "Send now" }).click();

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
  });

  it("does not report a send the provider refused", async () => {
    /* The whole point of recording automatically is that the record is
       true. A failed send that still marked the quotation "Sent" would
       arm the chasers for a message the customer never received. */
    const onSent = vi.fn();
    show({
      api: api(async () => { throw new IntegrationError("No WhatsApp number configured.", 400); }),
      onSent,
    });

    screen.getByRole("button", { name: "Send now" }).click();

    await waitFor(() => expect(screen.getByText("No WhatsApp number configured.")).toBeTruthy());
    expect(onSent).not.toHaveBeenCalled();
  });

  it("asks rather than records when the message is handed to WhatsApp itself", () => {
    /* wa.me opens WhatsApp with the words written. Nothing here knows
       whether the person then pressed send, so the caller is told it was
       handed off — never that it went. */
    const onSent = vi.fn();
    const onHandedOff = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    show({ api: api(async () => {}), onSent, onHandedOff });

    screen.getByRole("button", { name: "Open in WhatsApp instead" }).click();

    expect(onHandedOff).toHaveBeenCalledTimes(1);
    expect(onSent).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalled();
    open.mockRestore();
  });
});
