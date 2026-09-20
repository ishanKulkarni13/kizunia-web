> **Superseded.** This scratch note's concern — a stale notification/delivery should not be
> retried once it stops being useful — was resolved as
> [ND-D-13](../../project/feature-specification/notification/decisions/delivery.md#nd-d-13--a-stale-delivery-is-skipped-not-failed):
> a stale delivery is marked `SKIPPED`, not retried or failed, governed by
> `DELIVERY_CONFIG.pushValidForSeconds`. Original note preserved below for provenance.

---

### Expiry attribute for notification.

The notification system should have a expiry attribue
reason is  that if the system fails to deliver a notification "The registration closes tomarow" and the notification worker dosent notify the user. And then after two days we try to send the fails notiification. then the user should bnot be sent this notification cuz it is now no loney useful. This is why we need something similar to expirydate (Comeup with better name and terminology)