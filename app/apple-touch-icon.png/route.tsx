import { renderIcon } from "@/lib/icon/render";

export const dynamic = "force-static";

export function GET() {
  return renderIcon(180, true);
}
