import { getSetting } from "./db.js";

// Same catalog as the hosted KmerHosting LXC platform.
export const IMAGES = [
  { id: "ubuntu-26.04", family: "ubuntu", name: "Ubuntu", version: "26.04 LTS", alias: "ubuntu:26.04" },
  { id: "ubuntu-24.04", family: "ubuntu", name: "Ubuntu", version: "24.04 LTS", alias: "ubuntu:24.04" },
  { id: "ubuntu-22.04", family: "ubuntu", name: "Ubuntu", version: "22.04 LTS", alias: "ubuntu:22.04" },
  { id: "debian-13", family: "debian", name: "Debian", version: "13", alias: "images:debian/13" },
  { id: "debian-12", family: "debian", name: "Debian", version: "12", alias: "images:debian/12" },
  { id: "debian-11", family: "debian", name: "Debian", version: "11", alias: "images:debian/11" },
  { id: "debian-14", family: "debian", name: "Debian", version: "14 (testing)", alias: "images:debian/14" },
  { id: "debian-sid", family: "debian", name: "Debian", version: "Sid", alias: "images:debian/sid" },
  { id: "alpine-3.24", family: "alpine", name: "Alpine", version: "3.24", alias: "images:alpine/3.24" },
  { id: "alpine-3.23", family: "alpine", name: "Alpine", version: "3.23", alias: "images:alpine/3.23" },
  { id: "alpine-3.22", family: "alpine", name: "Alpine", version: "3.22", alias: "images:alpine/3.22" },
  { id: "alpine-3.21", family: "alpine", name: "Alpine", version: "3.21", alias: "images:alpine/3.21" },
  { id: "alpine-edge", family: "alpine", name: "Alpine", version: "Edge", alias: "images:alpine/edge" },
  { id: "rocky-9", family: "rocky", name: "Rocky Linux", version: "9", alias: "images:rockylinux/9" },
  { id: "rocky-8", family: "rocky", name: "Rocky Linux", version: "8", alias: "images:rockylinux/8" },
  { id: "alma-9", family: "alma", name: "AlmaLinux", version: "9", alias: "images:almalinux/9" },
  { id: "alma-8", family: "alma", name: "AlmaLinux", version: "8", alias: "images:almalinux/8" },
  { id: "centos-10", family: "centos", name: "CentOS Stream", version: "10", alias: "images:centos/10-Stream" },
  { id: "centos-9", family: "centos", name: "CentOS Stream", version: "9", alias: "images:centos/9-Stream" },
  { id: "fedora-44", family: "fedora", name: "Fedora", version: "44", alias: "images:fedora/44" },
  { id: "fedora-43", family: "fedora", name: "Fedora", version: "43", alias: "images:fedora/43" },
  { id: "amazon-2023", family: "amazon", name: "Amazon Linux", version: "2023", alias: "images:amazonlinux/2023" },
  { id: "arch", family: "arch", name: "Arch Linux", version: "Rolling", alias: "images:archlinux" },
  { id: "gentoo-systemd", family: "gentoo", name: "Gentoo", version: "systemd", alias: "images:gentoo/systemd" },
  { id: "gentoo-openrc", family: "gentoo", name: "Gentoo", version: "OpenRC", alias: "images:gentoo/openrc" },
  { id: "oracle-9", family: "oracle", name: "Oracle Linux", version: "9", alias: "images:oracle/9" },
  { id: "oracle-8", family: "oracle", name: "Oracle Linux", version: "8", alias: "images:oracle/8" },
  { id: "openeuler-24.03", family: "openeuler", name: "openEuler", version: "24.03", alias: "images:openeuler/24.03" },
  { id: "opensuse-16.0", family: "opensuse", name: "openSUSE", version: "16.0", alias: "images:opensuse/16.0" },
  { id: "opensuse-tumbleweed", family: "opensuse", name: "openSUSE", version: "Tumbleweed", alias: "images:opensuse/tumbleweed" },
  { id: "devuan-excalibur", family: "devuan", name: "Devuan", version: "Excalibur", alias: "images:devuan/excalibur" },
  { id: "devuan-daedalus", family: "devuan", name: "Devuan", version: "Daedalus", alias: "images:devuan/daedalus" },
  { id: "mint-21.3", family: "mint", name: "Linux Mint", version: "21.3", alias: "images:mint/21.3" },
  { id: "alt-p11", family: "alt", name: "ALT Linux", version: "p11", alias: "images:alt/p11" },
  { id: "alt-sisyphus", family: "alt", name: "ALT Linux", version: "Sisyphus", alias: "images:alt/Sisyphus" },
];

export function disabledImages() {
  try {
    return new Set(JSON.parse(getSetting("disabled_images") || "[]"));
  } catch {
    return new Set();
  }
}

export function availableImages() {
  const off = disabledImages();
  return IMAGES.filter((i) => !off.has(i.id));
}

export const imageById = (id) => IMAGES.find((i) => i.id === id) || null;
