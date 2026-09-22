export interface PoolAccount {
  id: string;
  phoneNumber: string;
  sessionString: string;
  status: "active" | "flood_wait" | "banned" | "disconnected";
  floodWaitUntil: Date | null;
}

export class AccountPool {
  private accounts: PoolAccount[] = [];
  private cursor = 0;

  load(accounts: PoolAccount[]): void {
    this.accounts = accounts.map((a) => ({ ...a }));
    this.cursor = 0;
  }

  private isAvailable(a: PoolAccount): boolean {
    if (a.status === "banned" || a.status === "disconnected") return false;
    if (a.status === "flood_wait") {
      if (!a.floodWaitUntil) return true;
      return a.floodWaitUntil.getTime() <= Date.now();
    }
    return a.status === "active";
  }

  next(): PoolAccount | null {
    if (this.accounts.length === 0) return null;
    for (let i = 0; i < this.accounts.length; i++) {
      const idx = (this.cursor + i) % this.accounts.length;
      const candidate = this.accounts[idx];
      if (this.isAvailable(candidate)) {
        this.cursor = (idx + 1) % this.accounts.length;
        return candidate;
      }
    }
    return null;
  }

  /**
   * Pega uma conta específica pelo id, respeitando disponibilidade.
   * Usado em campanhas globais onde cada target tem uma conta pré-atribuída
   * (porque o access_hash do dialog só vale pra essa conta).
   * Retorna null se a conta não existe no pool OU está indisponível
   * (flood_wait/banned/disconnected).
   */
  getById(id: string): PoolAccount | null {
    const a = this.accounts.find((x) => x.id === id);
    if (!a) return null;
    return this.isAvailable(a) ? a : null;
  }

  markFloodWait(id: string, seconds: number): void {
    const a = this.accounts.find((x) => x.id === id);
    if (!a) return;
    a.status = "flood_wait";
    a.floodWaitUntil = new Date(Date.now() + seconds * 1000);
  }

  waitSeconds(id?: string): number | null {
    const waits = this.accounts.filter(a => (!id || a.id === id) && a.status === "flood_wait" && a.floodWaitUntil)
      .map(a => Math.max(1, Math.ceil((a.floodWaitUntil!.getTime() - Date.now()) / 1000)));
    return waits.length ? Math.min(...waits) : null;
  }

  markBanned(id: string): void {
    const a = this.accounts.find((x) => x.id === id);
    if (!a) return;
    a.status = "banned";
  }
}
