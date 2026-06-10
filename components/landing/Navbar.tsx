'use client'

import { useState, useEffect } from 'react'
import { LionMark } from '@/components/brand/lion-mark'

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 32)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        scrolled
          ? 'bg-[#07040d]/85 backdrop-blur-xl border-b border-(--border-subtle)'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <a href="/" className="flex items-center gap-2.5 group">
            <LionMark size={28} />
            <span
              className="text-lg font-bold tracking-tight text-(--text-primary)"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Lion<span className="gradient-text">Bot</span>
            </span>
          </a>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-8">
            {navLinks.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                className="text-sm text-(--text-secondary) hover:text-(--text-primary) transition-colors duration-200 tracking-wide"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {label}
              </a>
            ))}
          </nav>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-4">
            <a href="/login" className="text-sm text-(--text-secondary) hover:text-(--text-primary) transition-colors">
              Entrar
            </a>
            <a href="/register" className="btn-primary text-xs! py-2.5! px-5!">
              Criar bot
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
          </div>

          {/* Mobile toggle */}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="md:hidden p-1.5 text-(--text-secondary) hover:text-(--text-primary) transition-colors"
            aria-label="Abrir menu"
          >
            {mobileOpen ? <XIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-[#07040d]/98 backdrop-blur-xl border-b border-(--border-subtle) px-4 pb-6">
          <nav className="flex flex-col gap-1 pt-3">
            {navLinks.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className="text-sm text-(--text-secondary) hover:text-(--text-primary) transition-colors py-2.5 px-2 rounded-lg hover:bg-white/[0.04]"
              >
                {label}
              </a>
            ))}
            <a href="/register" className="btn-primary mt-3 py-3!">
              Criar bot grátis
            </a>
          </nav>
        </div>
      )}
    </header>
  )
}

const navLinks = [
  { href: '#produto', label: 'Produto' },
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#depoimentos', label: 'Depoimentos' },
]

function MenuIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}
