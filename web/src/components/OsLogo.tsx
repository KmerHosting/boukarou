import {
  siAlmalinux, siAlpinelinux, siArchlinux, siCentos, siDebian, siDevuan, siFedora,
  siGentoo, siLinux, siLinuxmint, siOpensuse, siRockylinux, siUbuntu,
} from "simple-icons";

type Brand = { path: string; hex: string; title: string };

// Official distribution logos (simple-icons, CC0). Distributions without a published
// mark fall back to Tux, the Linux mascot.
const LOGOS: Record<string, Brand> = {
  ubuntu: siUbuntu,
  debian: siDebian,
  alpine: siAlpinelinux,
  rocky: siRockylinux,
  alma: siAlmalinux,
  centos: siCentos,
  fedora: siFedora,
  arch: siArchlinux,
  gentoo: siGentoo,
  opensuse: siOpensuse,
  mint: siLinuxmint,
  devuan: siDevuan,
};

function luminance(hex: string) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function OsTile({ family, large }: { family: string; large?: boolean }) {
  const brand = LOGOS[family] || siLinux;
  const light = luminance(brand.hex) > 0.6;
  const size = large ? 40 : 32;
  return (
    <span
      className={`os${large ? " os-lg" : ""}`}
      style={{ background: `#${brand.hex}` }}
      title={brand.title}
      aria-hidden="true"
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill={light ? "#1a1a1a" : "#ffffff"}>
        <path d={brand.path} />
      </svg>
    </span>
  );
}
