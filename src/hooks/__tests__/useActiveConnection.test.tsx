import React from "react";
import { act, create } from "react-test-renderer";
import { useActiveConnection } from "../useActiveConnection";
import { useSignalingStore } from "../../stores/useSignalingStore";

import { AppState } from "react-native";

// Mock @react-navigation/native useFocusEffect to capture the callback
let mockFocusCallback: (() => void) | null = null;
jest.mock("@react-navigation/native", () => {
  const localReact = require("react");
  return {
    useFocusEffect: jest.fn((callback) => {
      mockFocusCallback = callback;
      // Execute inside useEffect to align with React lifecycle
      localReact.useEffect(() => {
        callback();
      }, [callback]);
    }),
  };
});

const mockRemove = jest.fn();
let mockAppStateCallback: ((state: string) => void) | null = null;

jest.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: {
    currentState: "active",
    addEventListener: jest.fn((event: string, callback: any) => {
      if (event === "change") {
        mockAppStateCallback = callback;
      }
      return {
        remove: mockRemove,
      };
    }),
  },
}));

// Test component to execute the hook
function TestComponent() {
  useActiveConnection();
  return null;
}

describe("useActiveConnection Hook", () => {
  const mockConnect = jest.fn();
  const mockDisconnect = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockFocusCallback = null;
    mockAppStateCallback = null;
    (AppState as any).currentState = "active";

    // Mock signaling store
    useSignalingStore.setState({
      syncMode: "network",
      isConfigured: true,
      connectionStatus: "disconnected",
      connect: mockConnect,
      disconnect: mockDisconnect,
    });
  });

  it("should attempt connection on mount/focus if configured and disconnected", () => {
    act(() => {
      create(<TestComponent />);
    });
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("should not connect if syncMode is offline", () => {
    useSignalingStore.setState({ syncMode: "offline" });
    act(() => {
      create(<TestComponent />);
    });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("should not connect if isConfigured is false", () => {
    useSignalingStore.setState({ isConfigured: false });
    act(() => {
      create(<TestComponent />);
    });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("should not connect on focus if already connected", () => {
    useSignalingStore.setState({ connectionStatus: "connected" });
    act(() => {
      create(<TestComponent />);
    });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("should not connect on focus if already connecting", () => {
    useSignalingStore.setState({ connectionStatus: "connecting" });
    act(() => {
      create(<TestComponent />);
    });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("should attempt connection when focusCallback is triggered manually", () => {
    act(() => {
      create(<TestComponent />);
    });
    expect(mockConnect).toHaveBeenCalledTimes(1);

    mockConnect.mockClear();
    act(() => {
      mockFocusCallback?.();
    });
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("should force connection when app returns to foreground from background and disconnect in background", () => {
    act(() => {
      create(<TestComponent />);
    });
    expect(mockConnect).toHaveBeenCalledTimes(1); // Call on mount
    mockConnect.mockClear();

    expect(mockAppStateCallback).not.toBeNull();

    // Transition: active -> background
    act(() => {
      (AppState as any).currentState = "background";
      mockAppStateCallback?.("background");
    });
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockConnect).not.toHaveBeenCalled();

    // Transition: background -> active
    act(() => {
      (AppState as any).currentState = "active";
      mockAppStateCallback?.("active");
    });
    expect(mockConnect).toHaveBeenCalledTimes(1); // Force connection triggered
  });

  it("should clean up AppState event listener on unmount", () => {
    let renderer: any;
    act(() => {
      renderer = create(<TestComponent />);
    });
    act(() => {
      renderer.unmount();
    });
    expect(mockRemove).toHaveBeenCalled();
  });
});
