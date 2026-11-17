"use client";
import React from "react";
import { useSelector } from "react-redux";
import DescriptionTab from "./DescriptionTab";
import MarkdownTab from "./MarkdownTab";
import TestCasesTab from "./TestCasesTab";
import CodeStubTab from "./CodeStubTab";

const PANELS = {
  description: DescriptionTab,
  markdown: MarkdownTab,
  testcases: TestCasesTab,
  codestub: CodeStubTab,
};

export default function TabContent() {
  const activeTab = useSelector((state) => state.createProblem.activeTab);
  const Panel = PANELS[activeTab] ?? DescriptionTab;
  return <Panel />;
}
