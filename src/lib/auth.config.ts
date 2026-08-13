import type { NextAuthConfig } from "next-auth";

// Edge-safe config: no Credentials provider (it needs Prisma/bcrypt, which
// pull in Node APIs middleware's Edge runtime can't load). Middleware only
// needs to know whether a session exists, not how to establish one.
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    authorized: ({ auth, request }) => {
      const isLoggedIn = !!auth?.user;
      const isProtected = request.nextUrl.pathname.startsWith("/dashboard");
      return isProtected ? isLoggedIn : true;
    },
  },
} satisfies NextAuthConfig;
