export class KillSwitch {
  private active = false;
  private reason: string | null = null;
  private activatedAt: number | null = null;

  activate(reason: string): void {
    this.active = true;
    this.reason = reason;
    this.activatedAt = Date.now();
  }

  clear(): void {
    this.active = false;
    this.reason = null;
    this.activatedAt = null;
  }

  isActive(): boolean {
    return this.active;
  }

  snapshot(): { active: boolean; reason: string | null; activatedAt: number | null } {
    return {
      active: this.active,
      reason: this.reason,
      activatedAt: this.activatedAt,
    };
  }
}
