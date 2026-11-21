"use client";
import AreaHome from "@/app/arena/_components/AreaHome";

export default function FrontendHome() {
  return (
    <AreaHome
      areaId="frontend"
      extras={[{ href: "/frontend/playground", title: "Playground", text: "Try React components and async JavaScript with a live preview." }]}
    />
  );
}
