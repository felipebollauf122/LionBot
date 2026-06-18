import { ParticleExperience } from "@/components/landing/hero3d/particle-experience";

/**
 * Hero — o LEÃO em partículas é a PRIMEIRA coisa que o usuário vê (logo abaixo
 * do header/navbar). As ~600k partículas formam o leão e morpham nos textos
 * reais da landing conforme o scroll, reagindo ao mouse.
 * (A antiga headline "Você ainda vende no Telegram na mão?" foi removida — o
 * conteúdo dela já aparece formado pelas partículas.)
 */
export default function Hero() {
  return <ParticleExperience />;
}
