import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, safeEqual, sessionToken } from "@/lib/auth";

export async function proxy(req: NextRequest) {
  if (!process.env.APP_PASSCODE) {
    return new NextResponse("Set APP_PASSCODE to use the web app.", { status: 503 });
  }
  const cookie = req.cookies.get(SESSION_COOKIE)?.value ?? "";
  if (cookie && safeEqual(cookie, await sessionToken())) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login page, the Telegram webhook, the queue hand-over and static assets.
  matcher: ["/((?!login|api/telegram|api/queue|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
