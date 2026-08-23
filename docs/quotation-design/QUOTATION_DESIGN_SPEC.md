# TechZoid Quotation PDF Design Specification

Use `quotation_reference.png` as the visual reference. It is a DESIGN REFERENCE only. Never hard-code its sample customer names, dates, prices, GSTINs, SKUs, quotation numbers or totals.

## Goal
Create a premium A4 portrait quotation that looks like an SAP ERP-generated enterprise quotation: clean, structured, print-safe, highly aligned, restrained navy/gray/black palette, white background, no decorative clutter.

## Page
- A4 portrait
- 12–15 mm margins
- deterministic server-side PDF
- selectable text
- vector/SVG logos where possible
- automatic multi-page layout

## Header
Left: TechZoid logo, TECHZOID TECHNOLOGIES PRIVATE LIMITED, `Technology Procurement | Licensing | Hardware | Enterprise Solutions`.
Right: QUOTATION, quotation number, date, valid until, currency.
Use quotation format `TZ/QT/{FY}/{SEQ:4}`.
Add a thin full-width navy divider.

## Details
Use a three-column logical grid:
1. QUOTATION DETAILS: quotation no, date, valid until, customer ID, sales executive, enquiry reference.
2. BILL TO: company, address, GSTIN, contact, email, phone.
3. SHIP TO: company/site, address, contact, phone.
Below: Customer Reference | Enquiry Reference | Payment Terms | Delivery Terms.

Long text must wrap without overlap.

## Line-item table
Columns:
Sr. No. | Product / Service Description | Brand | Part / SKU | Qty | Unit | Unit Price (INR) | Discount (INR) | Taxable Value (INR)

Header: dark navy with white bold text.
Rows: white/light neutral, thin gray borders.
Description left aligned; numeric columns right aligned; qty/unit centered.
Brand logos centered in fixed boxes using contain/preserve aspect ratio.
Descriptions can grow vertically. Never clip or overflow.

## Totals and terms
Two-column section below items:
Left: TERMS & CONDITIONS.
Right: SUMMARY with Subtotal, Discount, Taxable Value, CGST, SGST, IGST, Grand Total and Amount in Words.
Grand Total must be prominent.
Use Indian currency formatting.
Calculate money with decimal-safe arithmetic, never browser floating point.

Do not hard-code tax rates. Show CGST/SGST or IGST according to actual quotation tax mode.

## Default terms
Quotation is valid for 30 days from the date of issue unless otherwise specified.
Prices are exclusive of applicable GST, taxes, duties, freight and other charges unless specifically stated otherwise.
Product, service and availability are subject to confirmation at the time of order.
Order confirmation is subject to receipt and acceptance of a valid Purchase Order and/or payment, as applicable.
Payment terms shall be as specified in this quotation and are subject to TechZoid's approved commercial terms.
Delivery timelines are indicative and may vary depending on product availability, manufacturer/distributor schedules and logistics.
Product specifications, models and availability may be subject to change by the respective manufacturer without prior notice.
Hardware products are subject to the applicable manufacturer's warranty and support terms.
Any installation, configuration, deployment or other professional services are included only where specifically mentioned in this quotation.
Any cancellation, modification or change to an order after confirmation shall be subject to applicable commercial and supplier terms.
The customer is responsible for providing accurate billing, delivery and order-related information required for fulfilment.
TechZoid Technologies Private Limited shall not be responsible for delays caused by circumstances beyond its reasonable control, including manufacturer, distributor, logistics or regulatory delays.
Acceptance of this quotation constitutes acceptance of the applicable terms and conditions stated herein, unless otherwise agreed in writing.
All disputes shall be subject to the jurisdiction of the courts at New Delhi, India.

Do not mention software licence keys, activation or provisioning in the standard terms.

## Partner badges
Place a compact `TECHNOLOGY PARTNER DESIGNATIONS` strip above the company footer.
Use only actual approved assets, including the supplied Microsoft Solutions Partner and Adobe Certified Reseller badges. Never fabricate or alter official badge wording.

## Technology partner logos
Use a compact `OUR TECHNOLOGY PARTNERS` row with approved logos such as Microsoft, Adobe, HP, Lenovo, Dell Technologies, Autodesk, Zoho and other verified brands. Preserve natural aspect ratios.

## ISO
Place `CERTIFIED MANAGEMENT SYSTEMS` beside the partner area and use the actual verified ISO 9001:2015, ISO/IEC 27001:2022 and ISO/IEC 20000-1:2018 badges. Never invent certification status.

## Footer
Company legal name, address, email, phone, website, GSTIN, PAN, CIN and optional verification QR code. Use company settings, not hard-coded sample data.
Bottom: `Thank you for the opportunity to submit this quotation.` and `Page X of Y`.

## Pagination and QA
Support 1, 5, 10, 20 and 50+ line items.
Repeat table headers on subsequent pages.
Never split totals, badges or footer awkwardly.
Never allow clipping, overlap, distorted logos, broken images or table overflow.
Test long product descriptions, long addresses, CGST/SGST, IGST, zero tax, discounts and missing optional fields.
Render PDFs to images and perform visual regression before release.

## Security
Customer-facing quotation number must be separate from internal database ID. Public verification URLs must use unguessable tokens. Never expose sequential database IDs.
