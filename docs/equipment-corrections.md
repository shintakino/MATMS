# Edit individual equipment and correct issue entries

For **Admin** and **Property Custodian**, open **Property Inventory → Individual equipment**, search the property number or serial, then open the device.

## Correct device details or serial

1. Select **Edit device details / serial** near the top of the device page.
2. Correct Brand, Model or Manufacturer serial number. If the serial is unavailable, clear it and enter the reason; otherwise leave that reason empty.
3. Update specifications, accessories, warranty, notes, location or condition as needed.
4. Enter the correction's Action date, Reference and Reason. The action date must be on or after the latest custody entry.
5. Select **Review device action**, check the old and new serial/details, then **Confirm and save**.

For shared item Article or Description changes, follow **Acquisition and stock card** to the inventory item and use its existing Edit item form.

The permanent property number and acquisition lot stay fixed. Earlier serials remain reserved for this same device, so a different device cannot reuse them. You can restore this device's own earlier serial. Custody history keeps the earlier values, actor, reference and reason. Stock does not change.

## Correct an incorrectly recorded issue

Use this only when the device is still **issued** and a recipient or issue detail was entered incorrectly.

1. Select **Correct recorded issue** near the top of the device page.
2. Review the original stock posting shown above the form. Correct **Recorded issue date**, **Recorded issue reference** and **Recorded issue purpose** as needed.
3. Choose the verified **Receiving teacher / personnel**. The current recipient starts selected; keep it when correcting only other fields.
4. Correct the device location and condition if needed.
5. Enter the correction's Action date, Reference and Reason, and check the confirmation that this fixes a mistaken entry without a physical handover.
6. Select **Review device action**, then **Confirm and save**.

This adds a linked correction without posting another receipt or issue. A device already issued keeps store balance **0**. The original stock date/reference/purpose remain on the Stock Card; corrected issue information is shown separately in custody history and ICS selection. Earlier as-of counts and finalized snapshots retain their saved history.

Closed issues and disposed devices remain read-only. A stale edit asks you to reopen the device and review the latest version. Failed saves retain form input.

## Record an actual change of teacher

For an actual handover, use **Record physical return**, confirm receipt, then **Issue to teacher / personnel** when the device is handed out. If you physically receive and immediately hand it to another person, use **Return and reissue to another person** and confirm both movements. These actions post the corresponding stock movements and keep the same permanent device identity.

## ICS after corrections

Select **Generate ICS / saved slips** from the device. New slips use the corrected recipient and manufacturer identity, with the permanent property number unchanged. Multiple devices still require the same recipient and fund.

Saved ICS versions keep their frozen serial, recipient and other details. An ordinary Edit of a saved slip preserves its existing line identity. To print corrected source details, generate a new slip after reviewing the corrected issue. If an old slip should leave active history, use its existing reason-bearing **Delete** action; it remains restorable with its original number and versions.

PPE uses external PAR references; this module does not generate a PAR or grant disposal authority.
