import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/** The input screen is kept on navigation, so the confirmed text is still there. */
export function StartAgainLink() {
  return (
    <Link href="/" className={buttonVariants({ className: "w-fit" })}>
      Start again
    </Link>
  );
}
