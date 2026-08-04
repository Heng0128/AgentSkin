// SPDX-License-Identifier: MPL-2.0

import { Component, type ErrorInfo, Fragment, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { rError } from '@/utils/renderer-log';

import { AlertCircleIcon } from '@hugeicons/core-free-icons';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  locale?: 'zh-CN' | 'en';
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

      const title = '出现错误';
      const desc = '发生了一个意外错误。';
      const tryAgain = '重试';
      const reload = '刷新应用';

      return (
        <main className="flex h-svh items-center justify-center bg-background text-foreground">
          <div className="flex flex-col items-center gap-4 text-center max-w-sm px-4">
            <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <HugeIcon icon={AlertCircleIcon} className="size-6 text-destructive" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
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
