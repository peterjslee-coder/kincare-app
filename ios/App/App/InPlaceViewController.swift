import UIKit
import Capacitor

class InPlaceViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        // Extend web view to full screen — CSS env(safe-area-inset-*) handles spacing
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
        additionalSafeAreaInsets = UIEdgeInsets(top: 0, left: 0, bottom: 0, right: 0)
        // Hide any native navigation/toolbar chrome
        navigationController?.setNavigationBarHidden(true, animated: false)
        navigationController?.setToolbarHidden(true, animated: false)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // Force web view to fill the entire screen, ignoring safe area
        webView?.frame = view.bounds
    }

    // Dark text/icons for the status bar (time, battery, signal) — readable on light backgrounds
    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .darkContent
    }

    // Status bar is always visible so users can check the time
    override var prefersStatusBarHidden: Bool {
        return false
    }
}
