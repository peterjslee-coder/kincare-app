import UIKit
import Capacitor

class InPlaceViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        // Extend web view to full screen — CSS env(safe-area-inset-*) handles spacing
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
        additionalSafeAreaInsets = UIEdgeInsets(top: 0, left: 0, bottom: 0, right: 0)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // Force web view to fill the entire screen, ignoring safe area
        webView?.frame = view.bounds
    }
}
