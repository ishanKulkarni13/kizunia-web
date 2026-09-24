# Kizunia Subscription & Membership
# Product Decisions and Initial Requirements

**Status:** Draft / Product Decision Document  
**Scope:** Subscription, membership, entitlements, trials, coupons, billing, paid features, admin grants, and future commerce  
**Payment Provider:** Razorpay (planned)  
**Plans:** Free, Pro, Pro+  
**Billing Cycles:** Monthly, Yearly  
**Implementation Status:** Not yet implemented  
**Document Purpose:** Record product decisions and requirements before architecture and implementation

---

# 1. Purpose

This document records the current product decisions and requirements for the Kizunia subscription and membership system.

The purpose of this document is to establish what the product should support before implementation begins.

This document is intentionally focused on:

- Product behavior
- Subscription behavior
- Plan capabilities
- Entitlements
- Limits
- Downgrades
- Trials
- Coupons
- Admin grants
- Notifications
- MCP access
- Future one-time purchases
- Billing expectations
- Reliability requirements
- General architectural constraints

This document does **not** prescribe the exact implementation architecture.

The implementation should be designed after auditing the existing Kizunia codebase, especially:

- Authentication
- Authorization
- Project ownership
- Portfolio
- Competition notifications
- Competition recommendations
- MCP
- Rate limiting
- Admin capabilities
- Error handling
- Background jobs
- Database architecture
- Existing event and webhook patterns

The implementation should preserve the requirements in this document while allowing the implementation architecture to be chosen based on the existing Kizunia codebase.

---

# 2. Current Product Direction

Kizunia will initially have three subscription plans:

1. Free
2. Pro
3. Pro+

The paid plans will support:

- Monthly billing
- Yearly billing

The initial product is intentionally simple.

The subscription system itself, however, should be designed to support future expansion without requiring a major rewrite.

Future requirements may include:

- More plans
- More fine-grained entitlements
- Free trials
- Admin-granted subscriptions
- Promotional access
- Coupons
- Discounted billing periods
- One-time purchases
- Paid portfolio themes
- More granular MCP access
- More paid features
- Features moving from paid to free
- Features moving from free to paid
- Additional commerce capabilities

---

# 3. Initial Plans

## 3.1 Free

The Free plan is available without requiring a paid subscription.

### Project ownership

A Free user can be the owner of at most:

**5 projects**

This limit applies to projects owned by the user.

It does not apply to projects where the user is only a member.

For example:

A user may own:

```text
Project A
Project B
Project C
Project D
Project E

and may also be a member of:

Project F
Project G
Project H
Project I
...

The number of projects in which the user is a member is not restricted by the Free ownership limit.

Portfolio

Free users cannot create a portfolio.

Competition deadline notifications

Free users cannot receive competition deadline notifications.

Competition recommendations

Free users cannot receive competition recommendations.

MCP

Free users do not receive MCP access unless the entitlement configuration is changed in the future.

4. Pro

Pro includes all Free functionality.

Pro initially provides:

Project ownership

A Pro user can own at most:

10 projects

The limit applies to owned projects only.

Membership in projects owned by other users is not counted toward this limit.

Portfolio

Pro users can create and use their portfolio.

Competition deadline notifications

Pro users can receive competition deadline notifications.

Competition recommendations

Initially, Pro does not include competition recommendations.

MCP

Initially, Pro does not include MCP access.

5. Pro+

Pro+ includes all functionality available in Pro and Free, plus additional capabilities.

Project ownership

A Pro+ user can own at most:

20 projects

Membership in projects owned by other users is not counted toward this limit.

Portfolio

Pro+ users can create and use their portfolio.

Competition deadline notifications

Pro+ users can receive competition deadline notifications.

Competition recommendations

Pro+ users can receive competition recommendations.

MCP

Pro+ users can access MCP.

MCP access may itself have multiple levels of access.

The exact MCP entitlement structure will be decided after auditing the existing MCP implementation.

The subscription system must therefore not assume that MCP access is simply a single permanent boolean capability.

The system should be capable of supporting fine-grained MCP entitlements.

6. Initial Feature Matrix
Capability	Free	Pro	Pro+
Own projects	5	10	20
Be a member of other projects	Yes	Yes	Yes
Create portfolio	No	Yes	Yes
Competition deadline notifications	No	Yes	Yes
Competition recommendations	No	No	Yes
MCP access	No	No	Yes
Monthly billing	No	Yes	Yes
Yearly billing	No	Yes	Yes

This table represents the initial product configuration.

It must not become a collection of hard-coded assumptions throughout the application.

The system should allow these capabilities and limits to change later.

7. Plans Must Be Configurable

The subscription system must not be designed around permanent assumptions such as:

Free always has X
Pro always has Y
Pro+ always has Z

The current feature matrix is the starting configuration.

The product may change later.

For example:

A feature that is currently paid may later become free.

Example:

Current:

Free
    Competition deadline notifications = No

Future:

Free
    Competition deadline notifications = Yes

Similarly, a feature that is currently free could later become paid.

Example:

Current:

Free
    Some future feature = Yes

Future:

Free
    Some future feature = No

The implementation should therefore support changing feature availability without requiring large-scale changes to application authorization logic.

8. Fine-Grained Entitlements

The subscription system should support fine-grained entitlements.

A plan should not be treated as the only source of authorization logic.

The application should ultimately be able to determine whether a user has a particular capability or quota.

Examples of possible capabilities include:

PORTFOLIO_CREATE
COMPETITION_DEADLINE_NOTIFICATIONS
COMPETITION_RECOMMENDATIONS
MCP_ACCESS

These are examples of capability concepts.

The actual naming and representation should be determined during the architecture phase.

The important requirement is that the system should be capable of adding new entitlements without redesigning the entire subscription system.

9. Project Limits

Project limits apply to project ownership.

They do not apply to project membership.

For example, if a user has a Free plan:

Owned projects:
5

Memberships:
20

The user is still within the Free ownership limit.

The system must distinguish between:

User owns project

and:

User is a member of project

This distinction is important and must be preserved during implementation.

10. Project Limit Enforcement

If a user's plan changes to a plan with a lower project ownership limit, existing projects must not be deleted.

Example:

Pro
10 owned projects

        ↓

Downgrade to Free

        ↓

Free limit = 5

The existing 10 projects remain.

The user should continue to have access to their existing projects according to normal project authorization rules.

However, the user should not be allowed to create additional owned projects while they are already above the new limit.

Example:

Existing owned projects: 10
New plan limit: 5

Create new project:
DENIED

The system must not automatically delete projects to bring the user below the new limit.

11. Downgrade Behavior

Downgrading should be non-destructive.

Existing user data must not be deleted simply because the user's subscription changes.

The general rule is:

Subscription downgrade changes what the user can newly access or create. It does not automatically destroy existing user data.

For projects:

Existing projects remain.

The user should not be forced to delete projects simply because their subscription has changed.

Creation of additional projects may be blocked until the user is below the new limit.

The exact behavior for every other feature will be defined separately.

12. Portfolio Downgrade Behavior

Portfolio behavior is different from project ownership.

A paid user can create a portfolio.

If their paid subscription ends and they become Free:

Portfolio data remains.

The portfolio should not be deleted.

The user should still be able to customize/edit the portfolio.

However, the portfolio should no longer be publicly displayed as an active public portfolio while the user does not have the required entitlement.

The intended behavior is:

Subscription active
        ↓
Portfolio exists
        ↓
Portfolio can be publicly displayed

After subscription ends:

Portfolio still exists
        ↓
User can still customize it
        ↓
Public portfolio is not displayed

The implementation should distinguish between concepts such as:

Portfolio exists
Portfolio is editable
Portfolio is published
Portfolio is publicly visible

The exact data model is an implementation decision.

13. Subscription Changes

A user should be able to change from one plan to another.

Examples:

Free → Pro
Free → Pro+

Pro → Pro+
Pro+ → Pro

Pro → Free
Pro+ → Free

The exact billing behavior of upgrades and downgrades will depend on the billing implementation and Razorpay capabilities.

The product requirements must remain independent of Razorpay-specific implementation details.

14. Monthly and Yearly Billing

Paid plans should support:

Monthly
Yearly

Both Pro and Pro+ should support these billing cycles.

The system should not assume that the monthly and yearly versions are separate products in the application domain.

The exact implementation model should be determined during architecture design.

15. Razorpay Integration

Razorpay will be used as the initial payment provider.

However, the Kizunia subscription architecture must not be tightly coupled to Razorpay.

The application should not make core authorization decisions directly from Razorpay objects.

For example, application feature authorization should not depend directly on:

razorpayPlanId
razorpaySubscriptionId
razorpayPaymentId

Instead, Razorpay should be treated as a billing/payment integration.

The internal Kizunia system should maintain the state required to determine what the user is entitled to.

16. Razorpay Must Not Be the Only Way to Grant Access

Kizunia must support granting access without Razorpay.

This is important because Razorpay integration may not be implemented immediately.

It must also be possible for an administrator to grant a user a plan without requiring a successful Razorpay subscription.

For example:

Admin
  ↓
Grant Pro
  ↓
User receives Pro entitlements

No Razorpay subscription should be required for this case.

This is required for:

Development
Testing
Internal users
Hackathon winners
Promotions
Support cases
Free access
Future marketing campaigns

The implementation should therefore separate:

How the user obtained access

from:

What the user is allowed to access
17. Admin Access

Platform administrators should have access to all subscription features.

Administrators should not need to purchase or subscribe to a plan.

Administrators should also have MCP access regardless of their subscription status.

Admin access is an operational authorization concern and should not require the admin to maintain a paid customer subscription.

The implementation must preserve the distinction between:

Administrator authorization

and:

Customer subscription entitlement

An administrator being able to use a feature does not necessarily mean that the administrator's customer subscription state should be considered Pro+.

The exact implementation should be decided after auditing the existing authorization system.

18. Admin Plan Grants

Platform administrators should eventually be able to grant a user a specific plan.

Example:

Admin Dashboard

User: user@example.com

Grant:
Pro+

Duration:
30 days

Reason:
Hackathon winner

The user should receive the appropriate effective entitlements.

This should not require Razorpay.

The grant should be auditable.

The implementation should support future administrative operations such as:

Grant plan
Revoke grant
Extend grant
Change grant duration
View grant history
Record reason
Record administrator who performed the action

The exact implementation is an architecture decision.

19. Coupons

Kizunia will eventually support coupon codes.

Coupons should be flexible.

A coupon may provide a discount rather than directly granting permanent access.

Examples:

10% off
50% off
99% off
₹100 off

A coupon may also potentially provide a plan for free.

For example:

Coupon:
FREEPRO30

Result:
Pro access for 30 days

The coupon system should therefore not be designed as only:

percentageDiscount

It should be extensible to support different promotional effects.

20. Coupon Example: First Billing Period Discount

A coupon may apply only to a specific billing period.

Example:

Pro monthly
₹X/month

Coupon:
99% off first month

The user applies the coupon.

The first billing period receives the discount.

After the first billing period:

Coupon no longer applies.

The recurring subscription continues at the normal price.

For example:

Month 1
99% discount
        ↓
Month 2
100% normal price
        ↓
Month 3
100% normal price
        ↓
...

If the user has enabled UPI AutoPay or another recurring payment mechanism, the normal recurring price should be charged after the promotional period according to the subscription terms.

The coupon must not permanently modify the underlying product price.

21. Coupon Scope

Coupons may eventually support rules such as:

First billing period only
First N billing periods
Percentage discount
Fixed amount discount
Free billing period
Free plan access for a specified duration
Plan-specific coupons
Expiration date
Maximum number of redemptions
User-specific coupons
Global promotional coupons

The exact supported coupon types will be determined during implementation planning.

The architecture should not prevent these future use cases.

22. Free Trials

Kizunia will support free trials.

Example:

1 month Pro trial

A trial should provide the corresponding plan's entitlements for the trial duration.

For example:

Free
  ↓
Pro Trial
  ↓
30 days
  ↓
Free

The exact trial behavior still requires product decisions.

Questions to resolve later include:

Whether a user can receive a trial more than once
Whether a trial requires payment method setup
Whether a trial automatically converts into a paid subscription
Whether the user must explicitly subscribe
Whether trials are available for Pro+
Whether an administrator can grant trials
Whether coupons can be applied to trials
What happens to features created during the trial
What happens to projects created during a trial
What happens to the portfolio after a trial ends

The architecture should be prepared for trials from the beginning even if the first implementation only supports a simple trial.

23. Failed Payments

The initial product requirement is:

7-day payment grace period

If a recurring payment fails:

Payment fails
     ↓
Grace period begins
     ↓
7 days
     ↓
Subscription access changes if payment is still unresolved

The grace period should be configurable.

It should not be hard-coded throughout the application.

The exact implementation should allow the grace period to be changed later.

24. Grace Period Behavior

The exact entitlements available during the payment grace period have not yet been finalized.

This requires further product discussion.

Potential questions include:

Does the user retain the portfolio?
Can the user continue creating projects?
Can the user receive notifications?
Can the user use MCP?
Can the user start new subscriptions?
Can the user retry payment?
What happens after successful payment during the grace period?

These should be explicitly decided before implementation of failed-payment handling.

25. Notification Preferences

Competition notification preferences should remain available to users regardless of whether they currently have access to the notification entitlement.

A Free user should be able to:

Turn notification toggles on
Turn notification toggles off
Configure competition preferences
Change preferences at any time
Change notification settings at any time

The absence of the entitlement should not prevent configuration.

26. Notification Delivery Entitlement

The distinction is:

Preference

versus:

Entitlement

A user can have:

Recommendation toggle:
ON

while not having the entitlement to receive recommendations.

In that case:

User preference:
ON

Entitlement:
NO

Result:
Do not prepare/send recommendation notifications

Similarly:

Deadline notifications:
ON

Entitlement:
NO

Result:
Do not prepare/send deadline notifications

The user should still be able to change the preference.

27. Notification Upgrade Behavior

Preferences should survive plan changes.

Example:

Free user

Recommendation:
ON

Preferred categories:
AI
Web Development

Preferred locations:
India

The user later upgrades to Pro+.

The existing preferences should remain.

The recommendation system can then begin using those preferences because the user now has the required entitlement.

The user should not have to configure their preferences again.

28. Notification Downgrade Behavior

If a user downgrades from a plan with notification access to a plan without it:

Preferences remain.

The notification system simply stops preparing/sending the restricted notifications.

If the user later upgrades again:

Previous preferences are still available.

This avoids destructive changes to user configuration.

29. Competition Deadline Notifications

Competition deadline notifications are initially available to:

Pro
Pro+

They are not initially available to:

Free

The entitlement should be independent from the user's notification preference.

The notification system should check the effective entitlement before preparing/delivering the notification.

30. Competition Recommendations

Competition recommendations are initially available only to:

Pro+

Free and Pro users may still configure their recommendation preferences.

However, the recommendation system should not prepare or send recommendation notifications when the user does not have the required entitlement.

This means recommendation preferences and recommendation delivery eligibility are separate concepts.

31. MCP

Kizunia already has an MCP implementation.

The subscription work must integrate with the existing MCP authorization architecture.

The subscription implementation should not replace or duplicate the existing MCP authorization system.

Instead, subscription entitlements should become another part of the access decision where appropriate.

32. Fine-Grained MCP Access

MCP access will eventually have different levels.

The system should therefore support more than:

MCP = enabled

as the only possible entitlement.

The exact levels have not yet been finalized.

The architecture should allow future capabilities such as:

MCP capability A
MCP capability B
MCP capability C

without requiring a redesign of the entire MCP system.

The actual MCP entitlement model should be determined after auditing the current MCP implementation.

33. Rate Limiting and Abuse Protection

A plan that provides a large or "unlimited" quota should not bypass infrastructure and abuse protection.

For example, a future plan may conceptually provide:

Unlimited projects

but Kizunia may still impose an internal operational safety ceiling such as:

100 projects

if required.

Therefore:

Product quota

and:

Operational / abuse protection

must remain separate.

"Unlimited" should mean:

The product does not intentionally impose a normal customer-facing quota for this resource.

It should not mean:

The user can bypass all system safety protections.

34. Future Unlimited Plans

The initial plans have fixed project limits:

Free = 5
Pro = 10
Pro+ = 20

A future plan may use an unlimited-style product quota.

Example:

MAX
Projects:
Unlimited

However, the implementation should still be able to apply:

Rate limits
Abuse protection
Infrastructure safety limits
Operational safeguards
Storage limits
Other platform protections

These should not be interpreted as contradicting the product-level "unlimited" entitlement.

35. Future One-Time Purchases

Kizunia will eventually support one-time purchases.

Example:

Portfolio Theme
₹100
One-time payment

A user may purchase an individual feature or digital product without subscribing to a recurring plan.

This is future scope but must influence the architecture from the beginning.

The subscription system should not be designed in a way that assumes:

Every entitlement comes from a subscription.

Future entitlement sources may include:

Subscription
Free trial
Admin grant
Coupon
Promotion
One-time purchase
36. Example Future One-Time Purchase

A future user may have:

Free plan
+
Purchased portfolio theme

The user may not have a Pro subscription.

However, they may still own the purchased theme.

Therefore:

Subscription status

and:

Purchased product ownership

must be conceptually separable.

The exact implementation will be determined later.

37. Entitlement Sources

The system should be designed so that an entitlement can potentially originate from different sources.

Potential sources include:

DEFAULT_FREE
PAID_SUBSCRIPTION
FREE_TRIAL
ADMIN_GRANT
COUPON
PROMOTION
ONE_TIME_PURCHASE

These are conceptual sources.

The exact domain model should be decided during architecture design.

The important requirement is that the feature enforcement layer should not need to know whether access came from Razorpay, an admin, a trial, or a purchase.

38. Effective Access

The application needs a reliable way to determine the user's current effective access.

For example:

User
    ↓
Current access state
    ↓
Effective capabilities
    ↓
Feature authorization / quota enforcement

The exact architecture for calculating this is intentionally not locked by this document.

Claude should determine the appropriate architecture after auditing the current Kizunia authorization and domain architecture.

The implementation should remain modular and extensible.

39. Subscription Provider Independence

The core application should not depend on Razorpay-specific identifiers for normal business logic.

Avoid spreading provider-specific concepts through:

Project services
Portfolio services
Notification services
MCP services
Authorization policies
UI components

For example, application code should not generally need logic such as:

if razorpaySubscriptionId exists

to determine whether a feature is available.

Razorpay integration should translate external billing state into Kizunia's internal subscription/access state.

40. Reliability Requirements

The subscription system is a financially sensitive system.

Reliability is a major requirement.

The implementation must be designed with:

Safe failure behavior
Idempotency
Proper logging
Auditability
Error handling
Webhook verification
Duplicate-event protection
Failure recovery
State reconciliation
Concurrency protection
Transactional consistency where appropriate
Clear subscription state transitions

The system should avoid assuming that external payment operations always succeed.

41. Razorpay Failure Must Not Corrupt Kizunia Access State

External billing systems can experience:

Network failures
Delayed responses
Duplicate webhooks
Missing webhooks
Out-of-order events
Temporary outages
Partial failures

The Kizunia system should therefore be designed to handle external billing failures safely.

The exact implementation should be determined during architecture design.

42. Webhooks

Razorpay webhooks will eventually be used to synchronize billing state.

Webhook handling should be:

Authenticated/verified
Idempotent
Auditable
Safe against duplicate events
Safe against unexpected event ordering
Recoverable

The exact webhook architecture should be determined after auditing the existing event and background-job infrastructure.

43. Subscription State

The subscription system should be capable of representing states beyond simply:

ACTIVE
INACTIVE

Potential lifecycle concepts include:

Active
Trialing
Past Due
Grace Period
Cancelled
Expired

The final state model should be decided during architecture design.

This document does not mandate the exact enum or database representation.

44. Cancellation

Subscription cancellation behavior still requires further product decisions.

Important distinction:

Cancel immediately

versus:

Cancel at end of current billing period

The system should eventually support whichever behaviors are required by the product and payment provider.

Cancellation should not automatically mean immediate destruction of user data.

45. Plan vs Entitlement

The product concept of a plan and the application's feature access should remain conceptually separate.

A plan is a product offering.

An entitlement is an effective capability or limit.

For example:

Pro

may currently provide:

PORTFOLIO
PROJECT_LIMIT = 10
COMPETITION_DEADLINE_NOTIFICATIONS

If the product changes later, the capabilities associated with Pro may change.

The application should therefore avoid scattering plan-specific conditionals throughout the codebase.

46. Avoid Hard-Coded Plan Checks

Avoid application-wide patterns such as:

if (user.plan === "PRO")

or:

if (user.plan === "PRO_PLUS")

inside feature implementations.

Instead, feature access should ultimately be based on the appropriate capability, entitlement, quota, or authorization decision.

The exact implementation is an architecture decision.

47. Subscription and Authorization

Subscription entitlements do not replace Kizunia's existing authorization system.

A user may have a Pro+ entitlement and still not be authorized to modify another user's resource.

For example:

Subscription entitlement
        +
Resource authorization
        =
Allowed operation

Both concerns must remain separate.

Subscription determines whether a user has access to a product capability.

Authorization determines whether the user is allowed to perform an operation on a particular resource.

48. Subscription and Rate Limiting

Subscription state should not replace rate limiting.

A paid user may receive higher product quotas, but they should still be subject to appropriate rate limits and abuse protection.

The rate limiting architecture should consume the effective entitlement information where required.

However, the rate limiter should not need to know Razorpay details.

49. Subscription and Notifications

The notification system should remain responsible for:

Notification preferences
Competition preferences
Notification generation
Notification delivery
Notification scheduling

The subscription system should provide the relevant entitlement information.

The notification system should then decide whether a notification is eligible to be prepared/delivered.

The subscription system should not become the notification system.

50. Subscription and MCP

The MCP system should remain responsible for MCP request handling and MCP-specific authorization.

Subscription entitlements should be one input into access decisions.

The subscription system should not become responsible for implementing MCP itself.

51. User Experience for Restricted Features

Users should receive clear feedback when they attempt to use a feature they do not have access to.

The system should not rely only on generic:

403 Forbidden

messages where a more meaningful product error can be provided.

Examples of possible user-facing situations:

You have reached your project limit.
Upgrade your plan to create more projects.
Competition recommendations are available on Pro+.
Competition deadline notifications are available on Pro and Pro+.

The exact wording will be decided by the UI implementation.

The backend should expose structured error information that the frontend can reliably interpret.

52. Error Handling

Subscription-related errors should be structured and consistent with Kizunia's existing error architecture.

Potential categories include:

SUBSCRIPTION_REQUIRED
ENTITLEMENT_REQUIRED
PROJECT_LIMIT_REACHED
SUBSCRIPTION_EXPIRED
SUBSCRIPTION_PAST_DUE
PAYMENT_REQUIRED
TRIAL_EXPIRED
COUPON_INVALID
COUPON_EXPIRED
COUPON_NOT_ELIGIBLE

These are examples and are not final error codes.

The actual error model should follow the existing Kizunia architecture.

53. Admin Operations Must Be Auditable

Administrative subscription operations should be logged.

For example:

Admin grants Pro+ to user

should record information such as:

Who performed the action
Which user was affected
What was granted
When it happened
Duration
Reason

The exact audit log structure should follow the existing Kizunia audit architecture.

54. Subscription History

The system should preserve sufficient historical information to understand how a user's access changed.

For example:

Free
    ↓
Pro Trial
    ↓
Pro
    ↓
Pro+
    ↓
Pro
    ↓
Free

The implementation should not only store the current state if doing so would make historical billing/access investigation impossible.

The exact persistence strategy is an architecture decision.

55. Plan Changes

Plan changes should be treated as meaningful domain events/state transitions.

Examples:

Free → Pro
Pro → Pro+
Pro+ → Pro
Pro → Free

The system should eventually be able to determine:

Previous effective access
New effective access
When the change occurred
Why the change occurred
Whether it was caused by billing
Whether it was caused by an admin
Whether it was caused by a trial
Whether it was caused by a coupon/promotion

The exact event model is an implementation decision.

56. Free Plan Representation

For the initial product, Free may be represented implicitly rather than creating a subscription record for every user.

This is intentionally not locked.

Claude should evaluate the existing Kizunia architecture and decide whether:

No paid subscription = Free

or:

Every user has an explicit Free membership/subscription

is more appropriate.

The final design should prioritize:

Correctness
Simplicity
Extensibility
Historical tracking
Reliability
Compatibility with future trials/grants/purchases
57. Admin Access Must Not Depend on Razorpay

An administrator should be able to use administrative functionality even if:

Razorpay is not configured
Razorpay integration is disabled
A Razorpay account has not yet been created
No paid subscription exists

Administrative access is a platform authorization concern.

It should not depend on payment provider availability.

58. Development Without Razorpay

The subscription architecture should allow development and testing before Razorpay is fully integrated.

For example:

Admin grants Pro to test user

should allow the developer to test:

Portfolio access
Project limits
Competition notifications
MCP access
Downgrade behavior
Entitlement checks

without requiring an actual payment.

This is important because the Razorpay integration may be implemented later.

59. Future Payment Providers

The architecture should not intentionally be designed around multiple payment providers today.

Razorpay is the planned provider.

However, the core domain should still avoid unnecessary coupling to Razorpay-specific objects.

This provides a reasonable level of separation without introducing unnecessary abstraction complexity.

The goal is not to build a generic payment-provider framework.

The goal is:

Keep Kizunia's product/access logic independent enough that Razorpay can be changed or unavailable without breaking the rest of the application.

60. Future Commerce

The long-term system may support:

Subscriptions
Trials
Coupons
Promotions
Admin grants
One-time purchases
Digital products
Paid portfolio themes

These should eventually be capable of contributing to user entitlements.

The initial implementation does not need to implement all of these.

However, the foundational architecture should avoid making them structurally impossible.

61. Initial Scope

The initial implementation should focus on:

Free
Pro
Pro+
Monthly billing
Yearly billing
Project ownership limits
Portfolio entitlement
Competition deadline notification entitlement
Competition recommendation entitlement
MCP entitlement
Admin access
Admin-granted plans
Subscription lifecycle
Failed payment handling
7-day configurable grace period
Upgrade behavior
Downgrade behavior
Reliable entitlement enforcement

The exact implementation order will be determined after the architecture audit.

62. Future Scope

The architecture should be prepared for:

Free trials
Coupon codes
Discount coupons
First-period discounts
Multi-period discounts
Free plan coupons
Admin plan gifting
Promotional grants
One-time purchases
Paid portfolio themes
More granular MCP access
More granular entitlements
Additional plans
Unlimited-style product quotas
Additional paid features
Features moving between Free and paid plans
63. Important Non-Goals

This document does not currently define:

Exact Razorpay API implementation
Exact Razorpay plan structure
Exact Razorpay webhook implementation
Exact database schema
Exact Prisma models
Exact subscription state enum
Exact coupon schema
Exact trial schema
Exact entitlement table structure
Exact API endpoints
Exact frontend UI
Exact MCP scopes
Exact notification job architecture
Exact billing reconciliation implementation

These should be decided after the existing codebase is audited.

64. Architectural Flexibility Requirement

The subscription system should be:

Modular
Maintainable
Extensible
Testable
Reliable
Observable
Safe against partial failures
Compatible with future entitlement types
Compatible with future access sources
Independent from provider-specific business logic

The system should not require rewriting core authorization whenever a new subscription feature is introduced.

65. Product Configuration vs Business Logic

The distinction between configuration and business logic should be preserved.

The following should ideally be configurable:

Project limit
Feature availability
Trial duration
Grace period
Coupon duration
Discount amount
Plan pricing
Billing interval

The following are business rules:

Existing projects are not deleted after downgrade.
Project ownership is different from project membership.
Restricted notification preferences remain configurable.
Paid feature access requires the appropriate entitlement.
Admin access does not require customer subscription.

The exact technical representation should be decided during implementation.

66. Important Invariants

The following should be treated as important product invariants.

Project ownership

A user's project ownership count is different from their project membership count.

Downgrade

Downgrading must not automatically delete existing projects.

Portfolio

A portfolio should not be deleted when the user's paid access ends.

Portfolio editing

The user may continue customizing their portfolio after losing the paid portfolio entitlement.

Public portfolio

The public portfolio should not be displayed when the required paid entitlement is no longer active.

Notification preferences

Users may configure notification preferences even when they do not have the entitlement to receive the notifications.

Notification delivery

Lack of entitlement prevents notification preparation/delivery but does not delete the user's preferences.

MCP

MCP access should support future fine-grained access levels.

Admin

Administrators do not need to purchase a plan to access platform capabilities.

Razorpay

Kizunia's core access system must not depend directly on Razorpay availability.

Data preservation

Subscription changes should generally change access rather than destroy user data.

67. Example: Free User
User
Plan: Free

Owned projects:
5

Memberships:
12

Portfolio:
Cannot create

Deadline notifications:
Cannot receive

Recommendations:
Cannot receive

MCP:
No access

The user may still configure notification preferences.

68. Example: Pro User
User
Plan: Pro

Owned projects:
8 / 10

Memberships:
15

Portfolio:
Available

Deadline notifications:
Available

Recommendations:
Not available

MCP:
Not available

The user may configure both deadline and recommendation preferences.

However, recommendation delivery remains unavailable until the user has the appropriate entitlement.

69. Example: Pro+ User
User
Plan: Pro+

Owned projects:
18 / 20

Memberships:
25

Portfolio:
Available

Deadline notifications:
Available

Recommendations:
Available

MCP:
Available

The user can configure recommendation preferences and receive recommendations.

70. Example: Pro Downgrade to Free

Before downgrade:

Plan: Pro

Owned projects:
10

After downgrade:

Plan: Free

Owned projects:
10
Allowed maximum:
5

The 10 projects remain.

The user cannot create another owned project.

The user can continue working with existing projects according to normal project authorization.

71. Example: Pro Portfolio Downgrade

Before downgrade:

Pro
Portfolio:
Public

After subscription ends:

Free
Portfolio:
Still stored
Editable:
Yes
Public:
No

No portfolio data is automatically deleted.

72. Example: Free User Configures Recommendations
Plan:
Free

Recommendation toggle:
ON

Preferred categories:
AI
Web Development

Preferred location:
India

The configuration is stored.

The recommendation system does not prepare or send recommendation notifications because the user does not have the recommendation entitlement.

If the user later upgrades to Pro+:

Existing preferences:
Preserved

Recommendation entitlement:
Available

Recommendation system:
Can begin using existing preferences
73. Example: 99% Coupon
Plan:
Pro

Billing:
Monthly

Coupon:
99% off

Duration:
First billing period

First period:

Discount:
99%

Next period:

Discount:
None

Normal Pro price:
Charged

The coupon does not permanently change the Pro plan price.

74. Example: Admin Grant
User:
Example User

Admin action:
Grant Pro+

Duration:
30 days

Payment:
None

Razorpay:
Not required

During the grant:

Pro+ entitlements:
Available

After the grant expires:

Effective access:
Returns according to the user's remaining access state

The exact precedence between grants, subscriptions, trials, and other access sources requires further design.

75. Example: Free Trial
User:
Free

Action:
Start Pro trial

Duration:
30 days

During trial:

Pro capabilities:
Available

After trial:

Trial ends

The resulting state depends on whether the user converted to a paid subscription or not.

Exact conversion behavior remains to be decided.

76. Example: Failed Payment
Pro subscription
       ↓
Recurring payment fails
       ↓
7-day grace period
       ↓
Payment succeeds
       ↓
Pro continues

If payment remains unresolved:

Grace period ends
       ↓
Access changes according to subscription policy

The exact entitlement state during grace period requires further product decisions.

77. Design Principle

The most important principle for this system is:

Billing determines access state, while entitlements determine what the application allows.

The application should not spread payment-provider logic throughout unrelated domains.

For example:

The project system should not need to understand Razorpay.

The portfolio system should not need to understand Razorpay.

The notification system should not need to understand Razorpay.

The MCP system should not need to understand Razorpay.

They should consume the appropriate internal access/entitlement decision.

78. Design Principle: Do Not Destroy User Data on Downgrade

Subscription changes should normally affect access and creation limits rather than destroying user data.

This is particularly important for:

Projects
Portfolio
Notification preferences
Competition preferences
MCP-related configuration

The user should not lose their data simply because their subscription changes.

79. Design Principle: Preferences Survive Access Changes

User configuration should generally survive entitlement changes.

Example:

Free
 ↓
Pro+
 ↓
Free
 ↓
Pro+

The user's notification preferences should remain available throughout.

This allows the system to disable and re-enable delivery without destroying configuration.

80. Design Principle: Feature Flags Are Not a Substitute for Entitlements

A generic feature flag system may be useful for development or rollout.

However, feature flags should not be used as the primary representation of customer subscription access.

Subscription entitlements represent product access.

Feature flags represent deployment or rollout behavior.

These concerns should remain separate unless the architecture determines otherwise.

81. Design Principle: Admin Overrides

Administrative grants and overrides should be treated as explicit access sources.

An admin granting a user Pro should not require creating a fake Razorpay payment.

The system should record the administrative action and derive the appropriate access.

82. Design Principle: No Provider Leakage

Provider-specific identifiers may exist at the billing integration boundary.

They should not leak unnecessarily into:

Domain authorization
Project services
Portfolio services
Notification services
MCP tools
Frontend feature checks

The exact boundary should be established during architecture design.

83. Design Principle: Extensibility Without Overengineering

The system should be designed for future requirements, but it should not become an unnecessarily generic enterprise billing framework.

Razorpay is the initial payment provider.

The goal is not to support every possible payment provider.

The goal is to maintain clean boundaries so that:

Razorpay can be integrated safely
Admin grants work independently
Trials can be added
Coupons can be added
One-time purchases can be added
New entitlements can be added
Plan configuration can change

without rewriting the core product.

84. Open Product Decisions

The following decisions remain open.

Subscription lifecycle
Exact subscription states
Upgrade timing
Downgrade timing
Cancellation timing
End-of-period cancellation
Immediate cancellation
Reactivation
Failed payment
Exact grace-period entitlements
Retry behavior
User messaging
Payment recovery
Final expiration behavior
Trials
Trial eligibility
Trial duration
Trial conversion
Payment method requirements
Trial limits
Multiple trials
Coupons
Coupon eligibility
Coupon stacking
First-period discounts
Multi-period discounts
Free-plan coupons
Plan-grant coupons
Redemption limits
Expiration
User-specific coupons
Admin grants
Duration
Permanent grants
Grant precedence
Grant revocation
Multiple grants
Audit requirements
MCP
Exact access levels
Scope model
Plan mapping
Rate limits per MCP level
Portfolio
Exact public visibility behavior
Published vs visible state
Portfolio URL behavior after downgrade
Theme ownership
One-time purchases
Purchase model
Refund behavior
Theme ownership
Purchase entitlement lifecycle

These decisions should be made before the corresponding functionality is implemented.

85. Architecture Audit Requirement

Before implementation, the following existing Kizunia systems must be audited:

Authentication

Determine:

How users are authenticated
How sessions are represented
How user identity reaches backend services
Existing authentication boundaries
Authorization

Determine:

Existing authorization architecture
Existing action/capability model
Existing policy model
How platform-level permissions are enforced
How resource ownership is checked
How admin bypass works
Projects

Determine:

How project ownership is stored
How membership is stored
How project creation is authorized
Where project creation can be safely restricted
Whether project counting can be performed safely under concurrency
Portfolio

Determine:

How portfolio creation works
How portfolio visibility works
How public portfolio routes work
How portfolio editing is authorized
Whether portfolio publication and visibility are already separate
Notifications

Determine:

Current notification architecture
Notification preferences
Background jobs
Recommendation generation
Deadline notification generation
Notification delivery
Where entitlement checks should be integrated
MCP

Determine:

Existing MCP authentication
Existing MCP authorization
Existing MCP scopes
Existing MCP tool structure
Existing rate limiting
How subscription entitlements can be integrated
Rate limiting

Determine:

Existing rate limit architecture
Existing policy resolution
Existing entitlement integration points
How subscription-specific limits can be represented
Admin

Determine:

Existing admin authorization
Existing admin dashboard
Existing audit logging
Existing administrative actions
Database

Determine:

Existing schema conventions
Existing transaction patterns
Existing event patterns
Existing audit fields
Existing soft-delete conventions
Existing ID conventions
Errors

Determine:

Existing application error classes
Error codes
API error format
Frontend error handling
Existing authorization error patterns
86. Implementation Philosophy

The implementation should follow the existing Kizunia architectural standards rather than introducing a completely separate architecture.

The subscription system should feel like a native part of Kizunia.

It should use existing patterns where appropriate.

New abstractions should only be introduced when they solve an actual subscription requirement.

87. Reliability Philosophy

This system handles access to paid functionality.

Incorrect state can result in:

Users losing paid access
Users receiving access without payment
Incorrect billing state
Incorrect notifications
Incorrect project limits
Incorrect MCP access
Data access problems

Therefore the implementation should favor correctness and recoverability over shortcuts.

External payment state should be treated as unreliable input that must be validated and reconciled.

88. Final Initial Requirements

The initial subscription system must support:

Plans:
    Free
    Pro
    Pro+

Billing:
    Monthly
    Yearly

Project ownership:
    Free = 5
    Pro = 10
    Pro+ = 20

Portfolio:
    Free = unavailable
    Pro = available
    Pro+ = available

Deadline notifications:
    Free = unavailable
    Pro = available
    Pro+ = available

Recommendations:
    Free = unavailable
    Pro = unavailable
    Pro+ = available

MCP:
    Free = unavailable
    Pro = unavailable
    Pro+ = available

Admin:
    Full access
    No subscription required

Downgrade:
    Existing projects preserved
    New projects restricted when over limit
    Portfolio preserved
    Portfolio remains editable
    Public portfolio becomes unavailable

Notifications:
    Preferences remain configurable
    Preferences can be enabled/disabled regardless of plan
    Restricted notifications are not prepared/sent

Payment:
    Razorpay
    Core system not tightly coupled to Razorpay

Failed payment:
    7-day configurable grace period

Future:
    Trials
    Coupons
    Admin grants
    Promotional access
    One-time purchases
    Paid portfolio themes
    Fine-grained MCP access
    Fine-grained entitlements
    Additional plans
89. Final Architectural Constraint

The subscription implementation must preserve the following high-level separation:

                    Payment Provider
                         │
                         ▼
                  Billing Integration
                         │
                         ▼
                Kizunia Subscription /
                  Membership State
                         │
                         ▼
                 Effective Access /
                   Entitlements
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
    Projects         Portfolio       Notifications
                                          
                         │
                         ▼
                        MCP

The exact internal architecture is intentionally not prescribed by this document.

Claude should determine the appropriate implementation architecture after auditing the existing Kizunia codebase.

The implementation must satisfy the product requirements in this document while remaining:

Modular
Extensible
Maintainable
Reliable
Testable
Observable
Safe under failures
Compatible with future subscription features
Compatible with future one-time purchases
Independent from Razorpay-specific business logic
90. Document Status

This document records the current product decisions and initial requirements.

It is not the final technical architecture.

The next step is to audit the existing Kizunia codebase and produce a technical architecture specification based on:

This product decision document
            +
Existing Kizunia architecture
            +
Existing authorization system
            +
Existing MCP system
            +
Existing notification system
            +
Existing rate limiting
            +
Existing database conventions

Only after that architecture is reviewed should implementation begin.

The implementation should not reinterpret these product requirements without documenting the reason for the change.