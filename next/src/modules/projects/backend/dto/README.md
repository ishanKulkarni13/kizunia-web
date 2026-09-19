1. DTOs are contracts between layers.

2. DTOs contain no validation.

3. DTOs contain no business logic.

4. Input DTOs use IDs for relations.

5. Output DTOs expand relations.

6. DTOs never expose Prisma models.

7. Repository never returns DTOs.

8. Services only consume and return DTOs.

9. Controllers never return Prisma models.

10. DTOs are plain TypeScript interfaces.