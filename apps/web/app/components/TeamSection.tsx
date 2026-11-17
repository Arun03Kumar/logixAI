"use client";

import Image from "next/image";
import { useState } from "react";
import { Container } from "@logixai/ui";
import SectionHeading from "./SectionHeading";

type Member = {
  name: string;
  institute: string;
  img: string;
  initials: string;
};

const TEAM: Member[] = [
  { name: "Aryesh Rai", institute: "IIT Delhi", img: "/team/aryesh.jpg", initials: "AR" },
  { name: "Nirbhay Gupta", institute: "IIT Delhi", img: "/team/nirbhay.jpg", initials: "NG" },
  { name: "Arun Kumar", institute: "IIT Jodhpur", img: "/team/arun.jpg", initials: "AK" },
  { name: "Shubham Singh", institute: "IIIT Lucknow", img: "/team/shubham.jpg", initials: "SS" },
  { name: "Abhishek Pratap", institute: "IIT Delhi", img: "/team/abhishek.jpg", initials: "AP" },
  { name: "Abhishek Singh", institute: "IIIT Lucknow", img: "/team/abhisingh.jpg", initials: "AS" },
];

function MemberCard({ member }: { member: Member }) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative size-24 overflow-hidden rounded-full border border-border bg-muted">
        {!imgError ? (
          <Image
            src={member.img}
            alt={member.name}
            fill
            sizes="96px"
            className="object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="grid h-full w-full place-items-center text-xl font-semibold text-muted-foreground">
            {member.initials}
          </span>
        )}
      </div>
      <h3 className="mt-4 text-sm font-semibold">{member.name}</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">{member.institute}</p>
    </div>
  );
}

export default function TeamSection() {
  return (
    <section id="team" className="py-20 md:py-28">
      <Container size="xl">
        <SectionHeading eyebrow="The people behind LogixAI" title="Meet the team" align="center">
          IIT and IIIT graduates with one mission: helping every student
          discover their X factor.
        </SectionHeading>
        <div className="mt-14 grid grid-cols-2 gap-10 sm:grid-cols-3 lg:grid-cols-6">
          {TEAM.map((member) => (
            <MemberCard key={member.name} member={member} />
          ))}
        </div>
        <p className="mt-14 text-center text-sm text-muted-foreground">
          Want to join us?{" "}
          <a
            href="mailto:info@logixai.com"
            className="font-semibold text-primary hover:underline"
          >
            Get in touch
          </a>
        </p>
      </Container>
    </section>
  );
}
