import { Inter, Roboto } from "next/font/google";

/*
 * Fontes de reserva para a prévia no desktop.
 *
 * No aparelho real o clone usa a fonte do sistema (SF Pro no iPhone, Roboto
 * no Android) — é isso que torna a tela indistinguível do Telegram. No
 * dashboard, porém, o navegador não tem SF Pro; Inter é a que mais se
 * aproxima em métricas, e Roboto vem do Google Fonts para o modo Android.
 * Os dois entram como variáveis CSS e ficam atrás da fonte nativa na pilha.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--tgc-font-inter",
  display: "swap",
});

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--tgc-font-roboto",
  display: "swap",
});

export const tgFontsClassName = `${inter.variable} ${roboto.variable}`;
