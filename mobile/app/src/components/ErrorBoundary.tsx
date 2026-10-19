import React, { Component, ReactNode } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { JOURNEYS, track } from "../analytics/analytics";

/**
 * The first frame of a React component stack, which identifies where the
 * crash surfaced. A full stack is unbounded and highly repetitive; the top
 * frame is what makes two crashes comparable in aggregate.
 */
function firstFrameComponent(componentStack: string | undefined): string {
  if (!componentStack) return "unknown";
  const [first] = componentStack.split("\n");
  return (first ?? "").trim().replace(/\s*\(.*\)$/, "") || "unknown";
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // A render-time crash is a different failure mode from the in-flow errors
    // `Error Displayed` is designed for (invalid token, network unreachable,
    // ...), so it gets its own event rather than being conflated with them:
    // otherwise an unexpected crash and an expected error state look identical
    // in a dashboard.
    //
    // The error *message* is deliberately not sent. It can contain whatever
    // happened to be in scope at the throw site, including user input. The
    // error class name plus the topmost component are enough to locate the
    // crash from a source map.
    track({
      name: "Crash Reported",
      params: {
        journey: JOURNEYS.shared,
        error_name: error.name || "Error",
        error_code: error.name || "UNKNOWN",
        component: firstFrameComponent(info.componentStack),
        // The boundary always offers a retry, so a caught crash is always
        // recoverable from the user's point of view.
        recoverable: true,
      },
    });
    console.error("[ErrorBoundary] Crash:", error.message, info.componentStack);
  }

  reset = () => {
    // The mobile counterpart of §6 `Retry Clicked`: a user tapping "Try Again"
    // after a crash. Counted separately because a crash the user retries
    // straight through never becomes a support conversation.
    track({
      name: "Retry Clicked",
      params: {
        journey: JOURNEYS.shared,
        error_type: "unknown",
        attempt_number: 1,
      },
    });
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            {this.state.error?.message ?? "An unexpected error occurred."}
          </Text>
          <TouchableOpacity style={styles.button} onPress={this.reset}>
            <Text style={styles.buttonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F172A",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  title: { color: "#F87171", fontSize: 20, fontWeight: "700", marginBottom: 12 },
  message: { color: "#94A3B8", fontSize: 14, textAlign: "center", marginBottom: 24 },
  button: {
    backgroundColor: "#2563EB",
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
});
