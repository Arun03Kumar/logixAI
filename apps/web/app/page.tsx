import SiteHeader from "./components/layout/SiteHeader";
import HeroSection from "./components/HeroSection";
import PlatformSection from "./components/PlatformSection";
import AboutSection from "./components/AboutSection";
import XFactorSection from "./components/XFactorSection";
import ServicesSection from "./components/ServicesSection";
import TeamSection from "./components/TeamSection";
import CTASection from "./components/CTASection";
import Footer from "./components/Footer";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <HeroSection />
        <PlatformSection />
        <AboutSection />
        <XFactorSection />
        <ServicesSection />
        <TeamSection />
        <CTASection />
      </main>
      <Footer />
    </>
  );
}
