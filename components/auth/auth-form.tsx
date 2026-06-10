"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { LionMark } from "@/components/brand/lion-mark";

interface AuthFormProps {
  mode: "login" | "register";
}

const errorMessages: Record<string, string> = {
  "Invalid login credentials": "Email ou senha incorretos.",
  "Email not confirmed": "Email ainda não confirmado. Verifique sua caixa de entrada e a pasta de spam.",
  "User already registered": "Este email já está cadastrado.",
  "Password should be at least 6 characters": "A senha deve ter pelo menos 6 caracteres.",
  "Signup requires a valid password": "Informe uma senha válida.",
  "Unable to validate email address: invalid format": "Formato de email inválido.",
  auth_failed: "Falha na autenticação. Tente novamente.",
};

function translateError(message: string): string {
  return errorMessages[message] ?? message;
}

export function AuthForm({ mode }: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError) {
      setError(translateError(urlError));
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (mode === "register") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name } },
        });

        if (signUpError) {
          setError(translateError(signUpError.message));
          return;
        }

        if (data.session) {
          // Confirmação de email desligada no Supabase — entra direto.
          setSuccess("Conta criada com sucesso! Redirecionando...");
          await new Promise((r) => setTimeout(r, 300));
          router.replace("/dashboard");
          return;
        }

        if (data.user && !data.session) {
          // Supabase está com "Confirm email" ligado. Tenta um signIn
          // direto — se o projeto Supabase NÃO bloquear login sem confirmação,
          // o usuário entra na hora e tudo funciona sem ele precisar confirmar
          // o email. Se o projeto bloquear, cai no fallback de mostrar mensagem.
          const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (signInData?.session && !signInErr) {
            setSuccess("Conta criada com sucesso! Redirecionando...");
            await new Promise((r) => setTimeout(r, 300));
            router.replace("/dashboard");
            return;
          }
          setSuccess("Conta criada! Verifique seu email para confirmar o cadastro.");
          return;
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          setError(translateError(signInError.message));
          return;
        }

        await new Promise((r) => setTimeout(r, 300));
        router.replace("/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? translateError(err.message) : "Ocorreu um erro inesperado.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[420px] animate-up">
      {/* Logo */}
      <div className="mb-10">
        <div className="flex items-center gap-2.5 mb-1">
          <LionMark size={40} />
          <span className="text-lg font-bold tracking-tight page-title">
            Lion<span className="gradient-text">Bot</span>
          </span>
        </div>
      </div>

      {/* Heading */}
      <h1 className="text-[30px] font-bold tracking-tight mb-2 page-title">
        {mode === "login" ? "Bem-vindo de volta" : "Crie sua conta"}
      </h1>
      <p className="text-(--text-secondary) text-sm mb-8 leading-relaxed">
        {mode === "login"
          ? "Entre para gerenciar seus bots de vendas"
          : "Comece a automatizar suas vendas no Telegram"}
      </p>

      {/* Alerts */}
      {error && (
        <div className="mb-5 px-4 py-3 rounded-xl bg-gradient-to-r from-(--red-muted) to-transparent border border-(--red)/15 text-(--red) text-sm animate-in flex items-center gap-3">
          <div className="w-5 h-5 rounded-full bg-(--red)/20 flex items-center justify-center shrink-0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </div>
          {error}
        </div>
      )}
      {success && (
        <div className="mb-5 px-4 py-3 rounded-xl bg-gradient-to-r from-(--accent-muted) to-transparent border border-(--accent)/15 text-(--accent) text-sm animate-in flex items-center gap-3">
          <div className="w-5 h-5 rounded-full bg-(--accent)/20 flex items-center justify-center shrink-0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          {success}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === "register" && (
          <div>
            <label className="input-label">Nome</label>
            <input
              type="text"
              placeholder="Seu nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="input"
            />
          </div>
        )}

        <div>
          <label className="input-label">Email</label>
          <input
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="input"
          />
        </div>

        <div>
          <label className="input-label">Senha</label>
          <input
            type="password"
            placeholder="Minimo 6 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="input"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !!success}
          className="btn-primary w-full py-3! text-sm! mt-6!"
        >
          {loading ? (
            <span className="flex items-center gap-2.5">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Processando...
            </span>
          ) : mode === "login" ? "Entrar" : "Criar conta"}
        </button>
      </form>

      {/* Footer link */}
      <p className="text-(--text-muted) text-sm text-center mt-8">
        {mode === "login" ? (
          <>
            Nao tem conta?{" "}
            <a href="/register" className="text-(--accent) hover:text-(--accent-hover) transition font-medium">
              Criar conta
            </a>
          </>
        ) : (
          <>
            Ja tem conta?{" "}
            <a href="/login" className="text-(--accent) hover:text-(--accent-hover) transition font-medium">
              Entrar
            </a>
          </>
        )}
      </p>
    </div>
  );
}
