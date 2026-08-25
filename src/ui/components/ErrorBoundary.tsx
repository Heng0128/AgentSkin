// SPDX-License-Identifier: MPL-2.0

import { Component, type ErrorInfo, Fragment, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { rError } from '@/utils/renderer-log';

import type { AppLocale } from '@shared/i18n';
import { DEFAULT_LOCALE, uiMessages } from '@shared/i18n';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  locale?: AppLocale;
  /** Compact inline layout — used to wrap a single route so the app
   *  chrome (sidebar/titlebar/statusbar) stays usable when only the
   *  page content crashes. */
  inline?: boolean;
}

interface State {
  error: Error | null;
  hasError: boolean;
  resetKey: number;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, hasError: false, resetKey: 0 };
  }

  static getDerivedStateFromError(_error: Error): Partial<State> {
    return { error: _error, hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    rError('ErrorBoundary', `${error.message}\n${info.componentStack}`, error);
  }

  handleReset = () => {
    this.setState((prevState) => ({
      error: null,
      hasError: false,
      resetKey: prevState.resetKey + 1,
    }));
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const _t = uiMessages[this.props.locale ?? DEFAULT_LOCALE] ?? uiMessages[DEFAULT_LOCALE];
      const title = _t.errorTitle;
      const desc = _t.errorDescription;
      const tryAgain = _t.errorTryAgain;
      const reload = _t.errorReload;

      if (this.props.inline) {
        return (
          <div className="flex h-full min-h-[200px] items-center justify-center bg-background text-foreground">
            <div className="flex flex-col items-center gap-3 text-center max-w-sm px-4">
              <div className="flex size-10 items-center justify-center rounded-md bg-destructive/10">
                <AlertCircle className="size-5 text-destructive" />
              </div>
              <div>
                <h2 className="text-[16px] font-medium tracking-tight">{title}</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {this.state.error?.message ?? desc}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={this.handleReset}>
                  {tryAgain}
                </Button>
                <Button size="sm" onClick={this.handleReload}>
                  {reload}
                </Button>
              </div>
            </div>
          </div>
        );
      }

      return (
        <main className="flex h-svh items-center justify-center bg-background text-foreground">
          <div className="flex flex-col items-center gap-4 text-center max-w-sm px-4">
            <div className="flex size-12 items-center justify-center rounded-md bg-destructive/10">
              <AlertCircle className="size-6 text-destructive" />
            </div>
            <div>
              <h1 className="text-lg font-medium tracking-tight">{title}</h1>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {this.state.error?.message ?? desc}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={this.handleReset}>
                {tryAgain}
              </Button>
              <Button size="sm" onClick={this.handleReload}>
                {reload}
              </Button>
            </div>
          </div>
        </main>
      );
    }

    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}
