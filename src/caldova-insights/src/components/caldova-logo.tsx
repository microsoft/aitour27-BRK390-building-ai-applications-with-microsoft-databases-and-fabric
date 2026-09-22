import logoMarkup from "@/assets/caldova-logo.svg?raw";

interface CaldovaLogoProps {
    className?: string;
}

/**
 * Renders the Caldova wordmark inline so it inherits `currentColor` and stays
 * legible in both themes. An <img> tag could not adapt to the active theme.
 */
export function CaldovaLogo({ className }: CaldovaLogoProps) {
    return (
        <span
            role="img"
            aria-label="Caldova"
            className={className}
            dangerouslySetInnerHTML={{ __html: logoMarkup }}
        />
    );
}
