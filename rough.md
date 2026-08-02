apps/
└── web/
    └── src/
        │
        ├── app/                         # Next.js App Router only
        │   ├── (auth)/
        │   │   ├── login/
        │   │   │   └── page.tsx
        │   │   └── register/
        │   │       └── page.tsx
        │   │
        │   ├── (dashboard)/
        │   │   ├── layout.tsx
        │   │   ├── page.tsx
        │   │   └── todos/
        │   │       └── page.tsx
        │   │
        │   ├── api/
        │   │   └── auth/
        │   │       └── [...all]/
        │   │           └── route.ts
        │   │
        │   ├── layout.tsx
        │   ├── loading.tsx
        │   └── error.tsx
        │
        ├── features/
        │   │
        │   ├── auth/
        │   │   ├── components/
        │   │   │   ├── LoginForm.tsx
        │   │   │   └── RegisterForm.tsx
        │   │   │
        │   │   ├── hooks/
        │   │   │   └── useSession.ts
        │   │   │
        │   │   └── actions/
        │   │       └── logout.ts
        │   │
        │   └── todos/
        │       ├── components/
        │       │   ├── TodoCard.tsx
        │       │   ├── TodoList.tsx
        │       │   └── CreateTodo.tsx
        │       │
        │       ├── hooks/
        │       │   └── useTodos.ts
        │       │
        │       ├── queries/
        │       │   └── todo.query.ts
        │       │
        │       └── mutations/
        │           └── todo.mutation.ts
        │
        ├── components/
        │   ├── ui/                      # shadcn
        │   │   ├── button.tsx
        │   │   ├── dialog.tsx
        │   │   └── input.tsx
        │   │
        │   └── shared/
        │       ├── EmptyState.tsx
        │       └── Loading.tsx
        │
        ├── lib/
        │   ├── auth-client.ts
        │   ├── trpc/
        │   │   ├── client.ts
        │   │   ├── server.ts
        │   │   └── provider.tsx
        │   │
        │   ├── utils.ts
        │   └── constants.ts
        │
        ├── providers/
        │   ├── QueryProvider.tsx
        │   └── ThemeProvider.tsx
        │
        ├── hooks/
        │   └── useDebounce.ts
        │
        ├── stores/
        │   └── ui.store.ts
        │
        ├── styles/
        │   └── globals.css
        │
        ├── env.ts
        └── middleware.ts