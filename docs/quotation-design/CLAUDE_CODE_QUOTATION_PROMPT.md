# Claude Code: TechZoid Quotation PDF

Read `quotation_reference.png`, `QUOTATION_DESIGN_SPEC.md`, `quotation_design_tokens.json`, and `quotation_data_example.json` before coding.

Implement the quotation PDF in the existing TechZoid application. Match the reference's hierarchy, grid, typography, table, totals, partner badge strip, ISO strip and footer.

Do not hard-code sample transaction data. Use the application's real quotation/customer/item/company data.

Use the actual TechZoid logo and approved partner/ISO assets supplied separately.

The quotation must:
- look like a modern SAP ERP enterprise quotation
- be A4 portrait
- use `TZ/QT/{FY}/{SEQ:4}`
- support multiple pages and repeated line-item headers
- calculate taxes and totals safely
- preserve logo aspect ratios
- prevent overlap/clipping
- support long descriptions and addresses
- keep totals and certification/footer blocks together where possible
- pass visual tests with 1, 5, 10, 20 and 50+ items

Do not introduce fake partner designations, fake certifications, sample customer data or fixed prices.

After implementation, generate test PDFs and visually inspect rendered pages for alignment, pagination, table overflow, logo distortion and totals.
