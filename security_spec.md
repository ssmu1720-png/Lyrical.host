# Security Specification: LYRICAL Firestore Rules

## 1. Data Invariants
- **Identity & Ownership**: Every `UserProfile` document ID `{userId}` must strictly match `request.auth.uid` and `incoming().uid`.
- **Privilege Escalation Prevention**: Non-admin users cannot create a profile with `role == 'admin'` or `suspended == true`, nor can they modify `role` or `suspended` during updates.
- **Bot Isolation**: A `BotDocument` can only be created if `incoming().ownerId == request.auth.uid` and `exists(/databases/$(database)/documents/users/$(request.auth.uid))`. Only the owner or a verified admin (`ssmu1720@gmail.com` or `admins/{uid}`) can read, list, update, or delete a bot.
- **Temporal Integrity**: All `createdAt` and `updatedAt` fields must strictly equal `request.time`.
- **PII Protection**: User profiles (`/users/{userId}`) contain `email` and are strictly restricted to `isOwner(userId) || isAdmin()`. Blanket `isSignedIn()` reads or lists are forbidden.

## 2. The "Dirty Dozen" Payloads (Adversarial Test Vectors)
1. **Self-Assigned Admin Role (`users`)**: `{ uid: "u1", email: "a@b.com", name: "Hacker", role: "admin", suspended: false, createdAt: request.time, updatedAt: request.time }` -> `PERMISSION_DENIED`
2. **Shadow Field Injection (`users`)**: Adding `{ isVerified: true }` not in `hasOnly()` -> `PERMISSION_DENIED`
3. **Cross-User PII Read (`users`)**: User `u2` attempting `get(/users/u1)` -> `PERMISSION_DENIED`
4. **Unbounded String DoS (`bots`)**: `name` with 5,000 characters (`size() > 64`) -> `PERMISSION_DENIED`
5. **Orphaned Bot Creation (`bots`)**: User creating a bot without an existing `/users/{uid}` profile -> `PERMISSION_DENIED`
6. **Identity Spoofing on Bot (`bots`)**: User `u1` creating a bot with `ownerId: "u2"` -> `PERMISSION_DENIED`
7. **Timestamp Forgery (`bots`)**: Setting `createdAt` to a past timestamp instead of `request.time` -> `PERMISSION_DENIED`
8. **Immutable Field Mutation (`bots`)**: Changing `ownerId` or `createdAt` on an existing bot during `update` -> `PERMISSION_DENIED`
9. **Unauthorized List Scraping (`bots`)**: Querying `/bots` without `where('ownerId', '==', request.auth.uid)` -> `PERMISSION_DENIED`
10. **Terminal State Mutation (`deployments`)**: Attempting to update a deployment after `status` is `'success'` or `'failed'` -> `PERMISSION_DENIED`
11. **Unverified Admin Email Spoof**: Claiming `ssmu1720@gmail.com` with `email_verified == false` -> `PERMISSION_DENIED`
12. **Unauthorized Audit Log Creation (`adminActions`)**: Standard user attempting to write to `/adminActions/{id}` -> `PERMISSION_DENIED`
