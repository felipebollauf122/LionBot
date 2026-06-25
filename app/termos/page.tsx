import { LegalShell } from "../privacidade/page";

export const metadata = {
  title: "Termos de Uso — LionBot",
  description: "Condições de uso dos assistentes virtuais e páginas da LionBot.",
};

const UPDATED = "Junho de 2026";

export default function TermosPage() {
  return (
    <LegalShell title="Termos de Uso" updated={UPDATED}>
      <p>
        Bem-vindo à <b>LionBot Assistentes Digitais</b>. Ao acessar nossas páginas e utilizar
        nossos assistentes virtuais no Telegram, você concorda com estes Termos de Uso. Leia-os
        com atenção antes de prosseguir.
      </p>

      <h2>1. O serviço</h2>
      <p>
        A LionBot oferece assistentes virtuais (bots) que entregam conteúdos, materiais e suporte
        por meio do Telegram. As páginas de acesso servem para direcionar o usuário de forma segura
        e transparente ao assistente correspondente, registrando apenas os dados necessários à
        operação e à mensuração das campanhas.
      </p>

      <h2>2. Uso adequado</h2>
      <p>
        Você se compromete a utilizar o serviço de forma lícita, não empregando os assistentes para
        atividades fraudulentas, ofensivas, ou que violem direitos de terceiros ou a legislação
        vigente. Reservamo-nos o direito de suspender o acesso em caso de uso indevido.
      </p>

      <h2>3. Conteúdo de terceiros</h2>
      <p>
        Os assistentes podem direcionar a conteúdos, ofertas ou materiais de parceiros. A LionBot
        atua como intermediária tecnológica e não se responsabiliza por produtos ou serviços de
        terceiros, cabendo ao usuário avaliar cada oferta antes de aceitá-la.
      </p>

      <h2>4. Pagamentos</h2>
      <p>
        Quando houver oferta de produtos pagos dentro do assistente, os pagamentos são processados
        por provedores especializados. Valores, formas de pagamento e condições de entrega são
        apresentados ao usuário antes da confirmação. Eventuais reembolsos seguem a política do
        respectivo fornecedor e a legislação aplicável.
      </p>

      <h2>5. Propriedade intelectual</h2>
      <p>
        Marcas, layouts e conteúdos próprios da LionBot são protegidos. É vedada a reprodução sem
        autorização prévia.
      </p>

      <h2>6. Alterações</h2>
      <p>
        Podemos atualizar estes Termos a qualquer momento. A versão vigente estará sempre disponível
        nesta página, com a data da última atualização.
      </p>

      <h2>7. Contato</h2>
      <p>
        Dúvidas sobre estes Termos podem ser enviadas para{" "}
        <a href="mailto:contato@lionbot.app">contato@lionbot.app</a>.
      </p>
    </LegalShell>
  );
}
