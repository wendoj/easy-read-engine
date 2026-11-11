# Fixture letters

This folder holds 3 public sample letters and 5 invented letters. Real letters with personal details must never be added here (see `.kiro/steering/safety.md`).

## Public sample letters

These are blank templates or sample letters published by public bodies, used here only as test input. They are not letters sent to a real person and hold no personal data: names, addresses, dates, amounts and account numbers are placeholders in the source (for example `DD.MM.YYYY`, `£XXX.XX`, `5xxxxxxxx` and `[Insert here]`). The phone numbers, postal addresses and bank details in them belong to the councils, the Planning Inspectorate and national advice charities.

Licence: these are public samples. Copyright stays with each publisher. Public-sector information like this is generally reusable under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/); check with the publisher before reusing it outside testing.

| File | Source | Topic |
| --- | --- | --- |
| `council-tax-final-notice-east-cambridgeshire.txt` | East Cambridgeshire District Council, through Anglia Revenues Partnership (`angliarevenues.gov.uk/eastcambridgeshire`). Template PDF kept as `.pdf` | Council Tax final notice |
| `manchester-missed-council-tax-payment.txt` | Manchester City Council (`www.manchester.gov.uk/counciltax`). Sample PDF of the first and second reminders kept as `.pdf` | Missed Council Tax payment reminders |
| `planning-appeal-notification-letter.txt` | Planning Inspectorate template letter for local planning authorities, published on GOV.UK. Original `.odt` not kept | Notice of a planning appeal to people who commented on the application |

How the text files were made:

- Each `.txt` is the plain text extracted from the original file (`pypdf` for the PDFs, `textutil` for the `.odt`). The original download URLs were not recorded.
- In the East Cambridgeshire text, words that the PDF split across 2 lines (for example "Da" and "te") were joined again. Trailing spaces and runs of blank lines were removed. Nothing else was changed and no values were substituted.
- The PDFs have text in boxes, and extraction keeps the order the PDF stores them in. Some headings and labels in the East Cambridgeshire text are therefore out of place.
- The 2 PDFs are kept as typed-PDF input for testing text extraction (task 18).

## Invented letters

The `invented-*.txt` letters are invented for testing. They are written in the style of UK council letters but contain no real personal data:

- Names, councils, streets and towns are made up.
- Postcodes end in `ZZ` so they can't match a real address.
- Phone numbers are in Ofcom's ranges reserved for drama and fiction (020 7946 0xxx, 0113 496 0xxx, 0161 496 0xxx, 0306 999 0xxx).
- Reference numbers, dates and amounts are invented.

Each letter includes dates, amounts, a reference number, a phone number, an address and at least one required action, plus some long and passive sentences, so the checkers have something to catch.

| File | Topic |
| --- | --- |
| `invented-council-tax-reminder.txt` | Missed Council Tax instalment |
| `invented-housing-benefit-change.txt` | Housing Benefit reduced after an earnings change |
| `invented-repair-appointment.txt` | Housing repair appointment |
| `invented-parking-penalty.txt` | Parking Penalty Charge Notice |
| `invented-care-assessment.txt` | Adult social care needs assessment |
