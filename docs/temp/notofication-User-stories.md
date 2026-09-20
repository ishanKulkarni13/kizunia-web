# Kizunia Notifications — User Stories

## 1. Notification Inbox

### US-01 — Receive notifications

> As a user, I want to receive notifications relevant to me so that I don't miss important information or opportunities on Kizunia.
> 

### US-02 — View notifications

> As a user, I want to view my notifications in one place so that I can see what has happened on Kizunia.
> 

### US-03 — Identify unread notifications

> As a user, I want to distinguish unread notifications from notifications I have already read so that I can identify what needs my attention.
> 

### US-04 — Open the related resource

> As a user, I want to open the competition, portfolio, or other resource associated with a notification so that I can take action directly.
> 

---

# 2. Competition Discovery Notifications

### US-05 — Relevant competition notification

> As a user, I want to be notified when Kizunia finds a competition relevant to my preferences so that I can discover opportunities that interest me.
> 

### US-06 — Aggregate relevant competitions

> As a user, I want multiple relevant competitions found within a suitable period to be grouped into a single notification so that I am not overwhelmed by individual notifications.
> 

Example:

```
5 new competitions match your interests

[View competitions]
```

instead of five separate notifications.

### US-07 — Control relevant competition notifications

> As a user, I want to enable or disable notifications for competitions relevant to my preferences so that I can control whether Kizunia sends me these recommendations.
> 

### US-08 — Control the number of relevant competitions

> As a user, I want to control how many relevant competitions I am notified about so that I receive an amount of recommendations that is useful to me. -> not exact but approx
> 

---

# 3. Competition bookmark

note the bookmark feature is implemented
and instead of using the “waitlist” terms use bookmark

### US-09 — Add competition to bookmark (wistlist)

### US-10 — Remove competition from bookmark

### US-11 — bookmark competition deadline notification

> As a user, I want to be notified when an important deadline for a bookmarked competition is approaching so that I don't miss it.
> 

Example:

```
Registration closes tomorrow

Hackathon C1 registration closes in 1 day.

[View Competition]
```

### US-12 — Control bookmark deadline notifications

> As a user, I want to enable or disable deadline notifications for my wishlisted competitions so that I can control these reminders.
> 

---

# 4. Relevant Competition Deadlines

### US-13 — Relevant competition deadline notification

> As a user, I want to be notified when an important deadline for a competition relevant to me is approaching so that I don't miss an opportunity.
> 

This is different from wishlist deadlines:

```
Relevant competition
        ↓
"I might be interested"

Wishlist competition
        ↓
"I explicitly saved this"
```

### US-14 — Control relevant competition deadlines

> As a user, I want to enable or disable deadline notifications for competitions relevant to me so that I can control these reminders.
> 

---

# 5. Competition Lifecycle Notifications

### US-15 — Registration opened

> As a user, I want to be notified when registration opens for a competition relevant to me or one I am tracking so that I can register when registration becomes available.
> 

### US-16 — Registration closing

> As a user, I want to be notified when registration for a competition is approaching its closing deadline so that I have an opportunity to register before it closes.
> 

### US-17 — Registration closed

> As a user, I want to be notified when registration closes for a competition I am tracking, when that notification is enabled, so that I know registration is no longer available.
> 

### US-18 — Competition started

> As a user, I want to be notified when a competition I am tracking starts so that I know the competition has begun. ←- disabled by default, user can sustomic this for sure
> 

### US-19 — Competition cancelled

> As a user, I want to be notified when a competition I am tracking is cancelled so that I know that the competition is no longer proceeding.
> 

**Competition completed is intentionally excluded.**

---

# 6. User-Declared Competition Status

Kizunia does **not** know who actually registered or participated in an external competition.

The user can explicitly provide this information.

### US-20 — Mark competition as registered (we will have this feature)

> As a user, I want to mark a competition as registered so that Kizunia knows that I have registered for it.
> 

### US-21 — Mark competition as participated (wont impliment)

> As a user, I want to mark a competition as participated so that Kizunia knows that I participated in it. ←- actually there will be no Mark competition as participated feature only Mark competition as registered features
> 

These are **user-provided relationships**, not verified registration data from the competition platform.

---

# 7. Competition Updates

### US-22 — Receive an admin-designated competition update

> As a user, I want to receive a notification when Kizunia's admin determines that an important competition update should be communicated to me.
> 

The admin decides whether an update should generate a notification.

This avoids making the notification system understand whether every individual competition-field change is important.

### US-23 — Admin chooses notification recipients

> As an admin, I want to determine which users or user groups should receive a competition update notification so that notifications are sent only to relevant users.
> 

Kizunia should **not** assume:

```
"These are the regestered users"
```

because Kizunia does not own the competition registration system.

Possible Kizunia-known relationships can be used later, such as:

```
Wishlist users
Users who marked Registered
Relevant users
```

---

# 8. Notification Preferences

### US-24 — Fine-grained notification preferences

> As a user, I want to independently control different types of notifications so that I receive only the notifications I find useful.
> 

The preference categories currently identified are:

```
Competition
├── Relevant competition notifications
├── Relevant competition deadlines
├── Wishlist competition deadlines
└── Competition updates

Portfolio ()future
└── Contact notifications

Platform
├── Feature notifications
└── Promotional notifications
```

---

# 9. Notification Limits

### US-25 — Control recommendation volume

> As a user, I want to specify how many relevant competitions Kizunia should notify me about so that I am not overwhelmed by recommendations. ← approx
> 

### US-26 — Control maximum notification volume ← approx

> As a user, I want to specify a maximum amount of notification activity where applicable so that Kizunia does not overwhelm me with notifications.
> 

The exact meaning of the limits still needs to be defined during ideation — for example, whether the limit applies per notification batch, per day, or another period.

---

# 10. Portfolio Notifications — Future

### US-27 — Portfolio contact notification

> As a user, I want to receive a notification when someone submits a contact form through my portfolio so that I know someone is trying to contact me.
> 

**Future scope.**

---

# 11. Platform Notifications — Future

### US-28 — Feature notification

> As a user, I want to receive notifications about important new Kizunia features so that I know when new functionality becomes available.
> 

### US-29 — Promotional notification

> As a user, I want to control whether I receive promotional notifications from Kizunia so that I can choose whether to receive promotional communication.
> 

---

# 12. Subscription Notifications — Future

### US-30 — Subscription notification

> As a user, I want to receive relevant notifications about my subscription so that I can take action when necessary.
> 

Examples such as subscription expiry are **future scope**. We should leave architectural space for them without designing the subscription domain now.

---

# 13. Paid-plan access

Some notification capabilities will be available only to users whose plan provides them.

Currently identified as potentially paid:

```
Relevant competition notifications
Portfolio contact notifications
```

### US-31 — Plan-based notification access

> As a user, I want Kizunia to respect the notification capabilities included in my plan so that I only receive features available to me.
> 

The notification system should therefore support **entitlements**, but the subscription system itself remains future scope.

---

# Final User Story Set

```
NOTIFICATIONS
│
├── Notification Inbox
│   ├── Receive notifications
│   ├── View notifications
│   ├── Identify unread notifications
│   └── Open related resource
│
├── Competition Discovery
│   ├── Relevant competition notifications
│   ├── Aggregate multiple competitions
│   ├── Enable/disable relevant notifications
│   └── Control recommendation volume
│
├── Competition bookmark 
│   ├── Add to bookmark 
│   ├── Remove from bookmark 
│   ├── bookmark deadline notifications
│   └── Enable/disable bookmark comptition deadlines
│
├── Relevant Competition Deadlines
│   ├── Receive deadline notification
│   └── Enable/disable deadline notifications
│
├── Competition Lifecycle
│   ├── Registration opened
│   ├── Registration closing
│   ├── Registration closed
│   ├── Competition started <-- wont impliment (Competition started)
│   └── Competition cancelled
│
├── User Competition State
│   ├── Mark registered
│
├── Competition Updates
│   ├── Admin decides whether to notify
│   └── Admin determines recipient
│
├── Preferences
│   ├── Competition
│   ├── Portfolio
│   └── Platform
│
├── Limits
│   ├── Recommendation amount
│   └── Maximum notification volume
│
├── Future
│   ├── Portfolio contact
│   ├── Feature announcements
│   ├── Promotional
│   └── Subscription
│
└── Entitlements
    └── Plan-based notification capabilities
```