const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/views/public/copy-trading.ejs');

const newContent = `<%- include('../partials/header') %>

<script>
function publicCopyTradingApp() {
    return {
        selectedCategory: 'all',
        sortBy: 'roi',
        searchQuery: '',
        masters: <%- safeJson(typeof masters !== 'undefined' && masters && masters.length > 0 ? masters : []) %>,
        comments: <%- safeJson(typeof comments !== 'undefined' && comments ? comments : []) %>,
        commentFilter: 'all',
        newComment: {
            master_id: '',
            author_name: '',
            rating: 5,
            comment: ''
        },
        submittingComment: false,
        commentSuccess: '',
        commentError: '',

        getSparklineSvg(m) {
            const seed = ((m.id || 1) * 37) % 100;
            const pts = [];
            const count = 18;
            const width = 280;
            const height = 52;
            const risk = Number(m.risk_score || 2);
            
            for (let i = 0; i < count; i++) {
                const progress = i / (count - 1);
                const trend = Math.pow(progress, 1.22);
                const wave = Math.sin(i * 1.6 + seed) * (risk * 2.0);
                let y = (height - 8) - (trend * (height - 18)) + wave;
                y = Math.max(6, Math.min(height - 4, y));
                const x = (i / (count - 1)) * width;
                pts.push(\`\${x.toFixed(1)},\${y.toFixed(1)}\`);
            }
            const pathD = 'M ' + pts.join(' L ');
            const areaD = pathD + \` L \${width},\${height} L 0,\${height} Z\`;
            return { pathD, areaD };
        },

        getRiskBadge(score) {
            const s = Number(score || 2);
            if (s <= 2) return { label: 'Low Risk', level: '1-2', cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' };
            if (s <= 4) return { label: 'Balanced', level: '3-4', cls: 'bg-sky-500/10 text-sky-500 border-sky-500/20' };
            return { label: 'High Alpha', level: s + '/10', cls: 'bg-amber-500/10 text-amber-500 border-amber-500/20' };
        },

        get filteredMasters() {
            let list = this.masters.slice();
            if (this.selectedCategory !== 'all') {
                list = list.filter(m => (m.category || '').toLowerCase().includes(this.selectedCategory.toLowerCase()));
            }
            if (this.searchQuery.trim()) {
                const q = this.searchQuery.toLowerCase();
                list = list.filter(m => 
                    (m.name || '').toLowerCase().includes(q) || 
                    (m.strategy_name || '').toLowerCase().includes(q) || 
                    (m.category || '').toLowerCase().includes(q)
                );
            }
            if (this.sortBy === 'roi') {
                list.sort((a, b) => Number(b.total_roi) - Number(a.total_roi));
            } else if (this.sortBy === 'win_rate') {
                list.sort((a, b) => Number(b.win_rate) - Number(a.win_rate));
            } else if (this.sortBy === 'risk') {
                list.sort((a, b) => Number(a.risk_score || 2) - Number(b.risk_score || 2));
            } else if (this.sortBy === 'copiers') {
                list.sort((a, b) => Number(b.copiers_count) - Number(a.copiers_count));
            }
            return list;
        },

        get filteredComments() {
            if (this.commentFilter === 'all') return this.comments;
            if (this.commentFilter === 'general') return this.comments.filter(c => !c.master_id);
            return this.comments.filter(c => String(c.master_id) === String(this.commentFilter));
        },

        get commentStats() {
            if (!this.comments.length) return { avg: '5.0', count: 0 };
            const sum = this.comments.reduce((acc, c) => acc + (Number(c.rating) || 5), 0);
            return {
                avg: (sum / this.comments.length).toFixed(1),
                count: this.comments.length
            };
        },

        formatDate(dtStr) {
            if (!dtStr) return 'Just now';
            const d = new Date(dtStr);
            if (isNaN(d.getTime())) return dtStr;
            const now = new Date();
            const diffHours = Math.floor((now - d) / (1000 * 60 * 60));
            if (diffHours < 1) return 'Just now';
            if (diffHours < 24) return diffHours + 'h ago';
            const diffDays = Math.floor(diffHours / 24);
            if (diffDays === 1) return 'Yesterday';
            if (diffDays < 7) return diffDays + 'd ago';
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        },

        filterByTrader(masterId) {
            this.commentFilter = String(masterId);
            this.newComment.master_id = String(masterId);
            const el = document.getElementById('copy-trading-discussion');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        },

        async submitComment() {
            if (!this.newComment.comment.trim()) {
                this.commentError = 'Please enter your comment or review message.';
                return;
            }
            this.submittingComment = true;
            this.commentError = '';
            this.commentSuccess = '';

            try {
                const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
                const res = await fetch('/api/copy-trading/comment', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-CSRF-Token': token || ''
                    },
                    body: JSON.stringify({
                        master_id: this.newComment.master_id || null,
                        rating: this.newComment.rating,
                        comment: this.newComment.comment,
                        author_name: this.newComment.author_name
                    })
                });
                const data = await res.json();
                if (data.success && data.comment) {
                    this.comments.unshift(data.comment);
                    this.newComment.comment = '';
                    this.commentSuccess = '✓ Thank you! Your review has been posted to the copy trading discussion.';
                    setTimeout(() => { this.commentSuccess = ''; }, 6000);
                } else {
                    this.commentError = data.error || 'Failed to submit comment.';
                }
            } catch (err) {
                this.commentError = 'Network error while posting comment. Please try again.';
            } finally {
                this.submittingComment = false;
            }
        },

        async likeComment(comment) {
            if (comment._liked) return;
            comment._liked = true;
            comment.likes_count = (comment.likes_count || 0) + 1;
            try {
                const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
                await fetch('/api/copy-trading/comment/like', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-CSRF-Token': token || ''
                    },
                    body: JSON.stringify({ comment_id: comment.id })
                });
            } catch (e) {}
        }
    };
}
</script>

<div x-data="publicCopyTradingApp()">
    
    <!-- Hero Section -->
    <section class="py-20 bg-[#f5f5f7] dark:bg-[#000000] border-b border-black/[0.06] dark:border-white/[0.08] transition-colors duration-200">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 text-center space-y-4">
            <span class="px-3.5 py-1 rounded-full bg-[#D4A038]/10 text-[#D4A038] text-xs font-semibold uppercase tracking-wider inline-block">Institutional Copy Trading</span>
            <h1 class="text-4xl sm:text-6xl font-semibold tracking-[-0.035em] text-[#1d1d1f] dark:text-[#f5f5f7]">Mirror Top Wall Street Algorithms</h1>
            <p class="text-base text-[#86868b] dark:text-[#a1a1a6] max-w-2xl mx-auto leading-relaxed font-normal">Automate your portfolio growth with direct STP order replication from audited and verified master traders.</p>
            
            <div class="flex items-center justify-center gap-4 pt-2">
                <a href="#strategies-grid" class="px-6 py-2.5 rounded-full bg-primary hover:bg-primary-dark text-white font-medium text-xs shadow-xs transition">
                    Browse All Strategies &darr;
                </a>
                <a href="#copy-trading-discussion" class="px-6 py-2.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] text-[#1d1d1f] dark:text-[#f5f5f7] font-medium text-xs border border-black/[0.08] dark:border-white/[0.1] transition">
                    💬 Copier Discussion & Reviews (<span x-text="comments.length"></span>)
                </a>
            </div>
        </div>
    </section>

    <!-- Master Strategies Section -->
    <section id="strategies-grid" class="py-16 bg-[#f5f5f7] dark:bg-[#000000] transition-colors duration-200 border-b border-black/[0.06] dark:border-white/[0.08]">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 space-y-8">
            
            <!-- Controls Bar -->
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black/[0.06] dark:border-white/[0.08] pb-5">
                <div class="flex items-center space-x-2 overflow-x-auto pb-1 scrollbar-none text-xs">
                    <button type="button" @click="selectedCategory = 'all'" 
                            :class="selectedCategory === 'all' ? 'bg-primary text-white font-bold' : 'bg-white dark:bg-[#1c1c1e] text-[#86868b] border border-black/[0.06] dark:border-white/[0.08]'" 
                            class="px-3.5 py-1.5 rounded-full transition cursor-pointer whitespace-nowrap">
                        All Strategies
                    </button>
                    <button type="button" @click="selectedCategory = 'crypto'" 
                            :class="selectedCategory === 'crypto' ? 'bg-primary text-white font-bold' : 'bg-white dark:bg-[#1c1c1e] text-[#86868b] border border-black/[0.06] dark:border-white/[0.08]'" 
                            class="px-3.5 py-1.5 rounded-full transition cursor-pointer whitespace-nowrap">
                        Crypto Derivatives
                    </button>
                    <button type="button" @click="selectedCategory = 'multi-asset'" 
                            :class="selectedCategory === 'multi-asset' ? 'bg-primary text-white font-bold' : 'bg-white dark:bg-[#1c1c1e] text-[#86868b] border border-black/[0.06] dark:border-white/[0.08]'" 
                            class="px-3.5 py-1.5 rounded-full transition cursor-pointer whitespace-nowrap">
                        Multi-Asset Macro
                    </button>
                    <button type="button" @click="selectedCategory = 'forex'" 
                            :class="selectedCategory === 'forex' ? 'bg-primary text-white font-bold' : 'bg-white dark:bg-[#1c1c1e] text-[#86868b] border border-black/[0.06] dark:border-white/[0.08]'" 
                            class="px-3.5 py-1.5 rounded-full transition cursor-pointer whitespace-nowrap">
                        Forex & Gold
                    </button>
                </div>

                <div class="flex items-center space-x-3">
                    <div class="relative">
                        <input type="text" x-model="searchQuery" placeholder="Search strategies..." 
                               class="bg-white dark:bg-[#1c1c1e] border border-black/[0.08] dark:border-white/[0.08] text-xs rounded-full pl-8 pr-3 py-1.5 outline-none w-48 text-[#1d1d1f] dark:text-[#f5f5f7]" />
                        <svg class="w-3.5 h-3.5 text-[#86868b] absolute left-2.5 top-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    </div>

                    <select x-model="sortBy" class="bg-white dark:bg-[#1c1c1e] border border-black/[0.08] dark:border-white/[0.08] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-full px-3 py-1.5 text-xs font-semibold outline-none cursor-pointer">
                        <option value="roi">Sort: Top Return %</option>
                        <option value="win_rate">Sort: Highest Win Rate</option>
                        <option value="risk">Sort: Lowest Risk</option>
                        <option value="copiers">Sort: Most Copiers</option>
                    </select>
                </div>
            </div>

            <!-- Master Cards Grid -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <template x-for="master in filteredMasters" :key="master.id">
                    <div class="apple-card-elevated rounded-[28px] p-6 space-y-4 flex flex-col justify-between border border-black/[0.06] dark:border-white/[0.08] bg-white/80 dark:bg-[#161617]/80 backdrop-blur-2xl shadow-lg hover:shadow-xl transition-all">
                        
                        <div class="space-y-3.5">
                            <!-- Profile Header -->
                            <div class="flex items-start justify-between">
                                <div class="flex items-center space-x-3.5">
                                    <img :src="master.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'" :alt="master.name" class="w-12 h-12 rounded-2xl object-cover border border-black/[0.06] dark:border-white/[0.08] shadow-xs shrink-0" />
                                    <div class="overflow-hidden">
                                        <div class="flex items-center space-x-1">
                                            <h3 class="font-medium text-sm text-[#1d1d1f] dark:text-[#f5f5f7] truncate" x-text="master.name"></h3>
                                            <span class="text-primary text-xs">✓</span>
                                        </div>
                                        <p class="text-[11px] text-[#D4A038] font-medium truncate" x-text="master.strategy_name"></p>
                                    </div>
                                </div>
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 font-mono"
                                      :class="getRiskBadge(master.risk_score).cls"
                                      x-text="getRiskBadge(master.risk_score).label"></span>
                            </div>

                            <!-- Rating & Reviews pill -->
                            <div class="flex items-center justify-between text-xs px-1">
                                <div class="flex items-center space-x-1 text-amber-500 font-mono text-[11px]">
                                    <span>★★★★★</span>
                                    <span class="font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">4.9</span>
                                </div>
                                <button type="button" @click="filterByTrader(master.id)" class="text-[11px] text-primary hover:underline font-mono">
                                    💬 View Reviews &rarr;
                                </button>
                            </div>

                            <!-- 30-Day SVG Equity Curve Sparkline -->
                            <div class="bg-black/[0.02] dark:bg-white/[0.04] border border-black/[0.04] dark:border-white/[0.06] rounded-2xl p-2.5 space-y-1">
                                <div class="flex items-center justify-between text-[10px] font-mono text-[#86868b] dark:text-[#a1a1a6]">
                                    <span>30D Trajectory</span>
                                    <span class="text-gain font-bold" x-text="'+' + master.total_roi + '%'"></span>
                                </div>
                                <div class="h-12 w-full flex items-center justify-center overflow-hidden">
                                    <svg viewBox="0 0 280 52" class="w-full h-full overflow-visible">
                                        <defs>
                                            <linearGradient :id="'pub-spark-' + master.id" x1="0%" y1="0%" x2="0%" y2="100%">
                                                <stop offset="0%" stop-color="#10B981" stop-opacity="0.30"/>
                                                <stop offset="100%" stop-color="#10B981" stop-opacity="0.0"/>
                                            </linearGradient>
                                        </defs>
                                        <path :d="getSparklineSvg(master).areaD" :fill="'url(#pub-spark-' + master.id + ')'" />
                                        <path :d="getSparklineSvg(master).pathD" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                                    </svg>
                                </div>
                            </div>

                            <!-- Return & Win Rate Grid -->
                            <div class="grid grid-cols-2 gap-3 p-3 bg-black/[0.02] dark:bg-white/[0.04] rounded-2xl border border-black/[0.04] dark:border-white/[0.06]">
                                <div>
                                    <span class="text-[9px] text-[#86868b] dark:text-[#a1a1a6] uppercase font-mono block">Total Return</span>
                                    <p class="text-lg font-semibold text-gain font-mono" x-text="'+' + Number(master.total_roi).toFixed(1) + '%'"></p>
                                </div>
                                <div class="text-right">
                                    <span class="text-[9px] text-[#86868b] dark:text-[#a1a1a6] uppercase font-mono block">Win Rate</span>
                                    <p class="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] font-mono" x-text="Number(master.win_rate).toFixed(1) + '%'"></p>
                                </div>
                            </div>

                            <!-- Details Spec -->
                            <div class="space-y-1.5 text-xs font-mono">
                                <div class="flex justify-between text-[#86868b] dark:text-[#a1a1a6]">
                                    <span class="font-sans">Asset Focus:</span>
                                    <span class="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]" x-text="master.category || 'Multi-Asset'"></span>
                                </div>
                                <div class="flex justify-between text-[#86868b] dark:text-[#a1a1a6]">
                                    <span class="font-sans">Active Copiers:</span>
                                    <span class="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]" x-text="Number(master.copiers_count).toLocaleString() + ' traders'"></span>
                                </div>
                                <div class="flex justify-between text-[#86868b] dark:text-[#a1a1a6]">
                                    <span class="font-sans">Min Allocation:</span>
                                    <span class="font-semibold text-[#D4A038]" x-text="'$' + Number(master.min_allocation || 500).toLocaleString() + ' USD'"></span>
                                </div>
                            </div>

                            <!-- Bio -->
                            <p class="text-xs text-[#86868b] dark:text-[#a1a1a6] line-clamp-2 leading-relaxed" x-text="'\"' + (master.description || 'Institutional quantitative algorithm with automated risk control.') + '\"'"></p>
                        </div>

                        <!-- Action Button (Apple Pill) -->
                        <div class="space-y-2 pt-2">
                            <a href="/copy-trading/app" class="w-full block py-3 rounded-full bg-primary hover:bg-primary-dark text-white font-medium text-xs text-center shadow-[0_2px_8px_rgba(0,113,227,0.3)] transition active:scale-[0.98] cursor-pointer">
                                Copy Strategy &rarr;
                            </a>
                        </div>

                    </div>
                </template>
            </div>

        </div>
    </section>

    <!-- ============================================================================== -->
    <!-- COMMUNITY COMMENTS & STRATEGY DISCUSSION SECTION                               -->
    <!-- ============================================================================== -->
    <section id="copy-trading-discussion" class="py-20 bg-white dark:bg-[#0c0d0e] transition-colors duration-200">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 space-y-12">
            
            <!-- Section Header -->
            <div class="text-center space-y-3 max-w-3xl mx-auto">
                <span class="px-3.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider inline-block">
                    💬 Community Discussion & Copier Reviews
                </span>
                <h2 class="text-3xl sm:text-4xl font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                    Trader Insights & Strategy Reviews
                </h2>
                <p class="text-sm text-[#86868b] dark:text-[#a1a1a6] leading-relaxed">
                    Read verified performance feedback, ask strategy questions, and join discussions with over 1,240+ global traders mirroring Mainstreet algorithms.
                </p>
                
                <!-- Trust & Review Stats Ribbon -->
                <div class="flex flex-wrap items-center justify-center gap-6 pt-2 text-xs font-mono">
                    <div class="flex items-center space-x-1.5">
                        <span class="text-amber-500 font-bold text-sm">★★★★★</span>
                        <span class="font-bold text-[#1d1d1f] dark:text-[#f5f5f7]" x-text="commentStats.avg + ' / 5.0'"></span>
                        <span class="text-[#86868b]">Overall Rating</span>
                    </div>
                    <div class="w-1 h-1 rounded-full bg-[#86868b]/40"></div>
                    <div class="text-gain font-semibold">
                        <span>✓ 100% STP Verified Execution</span>
                    </div>
                    <div class="w-1 h-1 rounded-full bg-[#86868b]/40"></div>
                    <div>
                        <span class="text-primary font-bold" x-text="comments.length"></span>
                        <span class="text-[#86868b]">Active Reviews & Comments</span>
                    </div>
                </div>
            </div>

            <!-- Discussion Grid: Left (Post Form) | Right (Comments Feed) -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                <!-- Left: Post Comment & Review Form -->
                <div class="lg:col-span-5 apple-card-elevated rounded-[28px] p-6 sm:p-8 space-y-5 border border-black/[0.06] dark:border-white/[0.08] bg-white/90 dark:bg-[#161617]/90 backdrop-blur-2xl shadow-xl sticky top-24">
                    <div class="flex items-center justify-between border-b border-black/[0.06] dark:border-white/[0.08] pb-3.5">
                        <div class="flex items-center space-x-2.5">
                            <span class="text-xl">✍️</span>
                            <h3 class="font-semibold text-base text-[#1d1d1f] dark:text-[#f5f5f7]">Share Strategy Feedback</h3>
                        </div>
                        <span class="text-[10px] font-mono text-gain px-2 py-0.5 rounded-full bg-gain/10 border border-gain/20">Public Discussion</span>
                    </div>

                    <form @submit.prevent="submitComment()" class="space-y-4 text-xs font-sans">
                        <!-- Select Strategy or General -->
                        <div class="space-y-1.5">
                            <label class="block font-medium text-[#86868b] dark:text-[#a1a1a6]">Topic / Target Master Trader</label>
                            <select x-model="newComment.master_id" class="w-full bg-black/[0.02] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.1] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-xl px-3.5 py-2.5 outline-none font-medium cursor-pointer">
                                <option value="">🌐 General Copy Trading Discussion</option>
                                <template x-for="m in masters" :key="m.id">
                                    <option :value="m.id" x-text="'👤 ' + m.name + ' (' + m.strategy_name + ')'"></option>
                                </template>
                            </select>
                        </div>

                        <!-- 5-Star Rating Picker -->
                        <div class="space-y-1.5">
                            <label class="block font-medium text-[#86868b] dark:text-[#a1a1a6]">Your Strategy Rating</label>
                            <div class="flex items-center space-x-2">
                                <div class="flex space-x-1 cursor-pointer text-xl text-amber-400">
                                    <template x-for="star in [1, 2, 3, 4, 5]" :key="star">
                                        <button type="button" @click="newComment.rating = star" class="transition hover:scale-110 focus:outline-none">
                                            <span x-text="star <= newComment.rating ? '★' : '☆'" :class="star <= newComment.rating ? 'text-amber-400' : 'text-black/20 dark:text-white/20'"></span>
                                        </button>
                                    </template>
                                </div>
                                <span class="font-mono text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]"
                                      x-text="newComment.rating === 5 ? '5/5 - Exceptional Alpha' : newComment.rating === 4 ? '4/5 - Very Good' : newComment.rating === 3 ? '3/5 - Average' : newComment.rating + '/5'"></span>
                            </div>
                        </div>

                        <!-- Name input for prospective / community users -->
                        <% if (!user) { %>
                            <div class="space-y-1.5">
                                <label class="block font-medium text-[#86868b] dark:text-[#a1a1a6]">Your Name / Display Alias *</label>
                                <input type="text" x-model="newComment.author_name" placeholder="e.g. David M. - Zurich, CH" 
                                       class="w-full bg-black/[0.02] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.1] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-xl px-3.5 py-2.5 outline-none text-xs" />
                            </div>
                        <% } else { %>
                            <div class="flex items-center space-x-2.5 p-2.5 bg-black/[0.02] dark:bg-white/[0.04] rounded-xl border border-black/[0.04] dark:border-white/[0.06]">
                                <img src="<%= user.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80' %>" class="w-8 h-8 rounded-full object-cover border border-primary/30" />
                                <div>
                                    <span class="font-medium text-xs text-[#1d1d1f] dark:text-[#f5f5f7] block"><%= user.name %></span>
                                    <span class="text-[10px] text-gain font-mono">✓ Verified Account Session</span>
                                </div>
                            </div>
                        <% } %>

                        <!-- Comment Textarea -->
                        <div class="space-y-1.5">
                            <label class="block font-medium text-[#86868b] dark:text-[#a1a1a6]">Comment & Strategy Feedback *</label>
                            <textarea x-model="newComment.comment" rows="4" required placeholder="Share your experience with this strategy, ask questions regarding position sizing, or discuss market opportunities..." 
                                      class="w-full bg-black/[0.02] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.1] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-xl p-3 outline-none text-xs leading-relaxed"></textarea>
                        </div>

                        <!-- Feedback Alerts -->
                        <div x-show="commentError" class="p-3 rounded-xl bg-loss/10 border border-loss/30 text-loss text-xs font-medium" x-text="commentError"></div>
                        <div x-show="commentSuccess" class="p-3 rounded-xl bg-gain/10 border border-gain/30 text-gain text-xs font-medium" x-text="commentSuccess"></div>

                        <button type="submit" :disabled="submittingComment" 
                                class="w-full py-3 rounded-full bg-primary hover:bg-primary-dark text-white font-medium text-xs shadow-xs transition active:scale-[0.98] disabled:opacity-50 flex items-center justify-center space-x-1.5 cursor-pointer">
                            <span x-text="submittingComment ? 'Submitting Comment...' : 'Post Comment & Review &rarr;'"></span>
                        </button>
                    </form>
                </div>

                <!-- Right: Filter Tabs & Comments Stream -->
                <div class="lg:col-span-7 space-y-6">
                    
                    <!-- Filter Pills Bar -->
                    <div class="flex items-center space-x-2 overflow-x-auto pb-2 scrollbar-none text-xs">
                        <button type="button" @click="commentFilter = 'all'" 
                                :class="commentFilter === 'all' ? 'bg-primary text-white font-semibold' : 'bg-black/[0.03] dark:bg-white/[0.06] text-[#86868b] border border-black/[0.06] dark:border-white/[0.08]'" 
                                class="px-3.5 py-1.5 rounded-full transition cursor-pointer whitespace-nowrap">
                            All Reviews (<span x-text="comments.length"></span>)
                        </button>
                        <button type="button" @click="commentFilter = 'general'" 
                                :class="commentFilter === 'general' ? 'bg-primary text-white font-semibold' : 'bg-black/[0.03] dark:bg-white/[0.06] text-[#86868b] border border-black/[0.06] dark:border-white/[0.08]'" 
                                class="px-3.5 py-1.5 rounded-full transition cursor-pointer whitespace-nowrap">
                            General Discussion
                        </button>
                        <template x-for="m in masters" :key="m.id">
                            <button type="button" @click="commentFilter = String(m.id)" 
                                    :class="commentFilter === String(m.id) ? 'bg-primary text-white font-semibold' : 'bg-black/[0.03] dark:bg-white/[0.06] text-[#86868b] border border-black/[0.06] dark:border-white/[0.08]'" 
                                    class="px-3.5 py-1.5 rounded-full transition cursor-pointer whitespace-nowrap flex items-center space-x-1.5">
                                <span x-text="m.name"></span>
                            </button>
                        </template>
                    </div>

                    <!-- Comments Stream List -->
                    <div class="space-y-4">
                        <template x-for="comment in filteredComments" :key="comment.id">
                            <div class="apple-card-elevated rounded-[24px] p-5 sm:p-6 space-y-3.5 border border-black/[0.06] dark:border-white/[0.08] bg-white/80 dark:bg-[#161617]/80 backdrop-blur-2xl shadow-sm hover:shadow-md transition">
                                
                                <!-- Top Bar: Author Avatar, Name, Badges & Timestamp -->
                                <div class="flex items-start justify-between gap-3">
                                    <div class="flex items-center space-x-3">
                                        <img :src="comment.author_avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80'" 
                                             class="w-10 h-10 rounded-full object-cover border border-black/[0.06] dark:border-white/[0.08] shadow-xs shrink-0" />
                                        <div>
                                            <div class="flex items-center space-x-2 flex-wrap">
                                                <h4 class="font-semibold text-sm text-[#1d1d1f] dark:text-[#f5f5f7]" x-text="comment.author_name"></h4>
                                                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold border font-mono"
                                                      :class="comment.badge && comment.badge.includes('VIP') ? 'bg-amber-500/10 text-amber-500 border-amber-500/30' : 'bg-gain/10 text-gain border-gain/30'"
                                                      x-text="'✓ ' + (comment.badge || 'Verified Copier')"></span>
                                            </div>
                                            <span class="text-[11px] text-[#86868b] dark:text-[#a1a1a6] font-mono" x-text="formatDate(comment.created_at)"></span>
                                        </div>
                                    </div>

                                    <!-- Rating Stars & Pinned Indicator -->
                                    <div class="text-right shrink-0">
                                        <template x-if="comment.is_pinned">
                                            <span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#D4A038]/10 text-[#D4A038] border border-[#D4A038]/20 block mb-1">
                                                📌 PINNED
                                            </span>
                                        </template>
                                        <div class="text-amber-400 text-xs font-mono">
                                            <template x-for="i in 5">
                                                <span x-text="i <= (comment.rating || 5) ? '★' : '☆'"></span>
                                            </template>
                                        </div>
                                    </div>
                                </div>

                                <!-- Strategy Tag if referencing a master -->
                                <template x-if="comment.master_name">
                                    <div class="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-black/[0.02] dark:bg-white/[0.04] border border-black/[0.04] dark:border-white/[0.06] text-[11px] font-mono">
                                        <span class="text-[#86868b]">Reviewing:</span>
                                        <span class="font-semibold text-primary" x-text="comment.master_name"></span>
                                        <span class="text-[#86868b]">&bull;</span>
                                        <span class="text-[#D4A038]" x-text="comment.master_strategy"></span>
                                    </div>
                                </template>

                                <!-- Comment Body -->
                                <p class="text-xs sm:text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7] leading-relaxed font-sans" x-text="comment.comment"></p>

                                <!-- Bottom Bar: Helpful Thumbs Up -->
                                <div class="flex items-center justify-between pt-2 border-t border-black/[0.04] dark:border-white/[0.06] text-xs font-mono text-[#86868b]">
                                    <button type="button" @click="likeComment(comment)" 
                                            class="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-black/[0.02] dark:bg-white/[0.04] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition text-[11px] active:scale-95"
                                            :class="comment._liked ? 'text-gain font-bold' : 'text-[#86868b]'">
                                        <span>👍</span>
                                        <span x-text="comment._liked ? 'Helpful (' + comment.likes_count + ')' : 'Helpful (' + (comment.likes_count || 0) + ')'"></span>
                                    </button>

                                    <span class="text-[11px] text-[#86868b]/70">Verified STP Copier</span>
                                </div>

                            </div>
                        </template>

                        <!-- Empty State -->
                        <template x-if="filteredComments.length === 0">
                            <div class="text-center py-12 bg-black/[0.02] dark:bg-white/[0.03] rounded-3xl border border-black/[0.06] dark:border-white/[0.08] p-6 space-y-2">
                                <span class="text-3xl">💬</span>
                                <h4 class="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">No Comments Found in this Filter</h4>
                                <p class="text-xs text-[#86868b] max-w-sm mx-auto">Be the first to share your strategy feedback or ask questions for this master trader.</p>
                                <button type="button" @click="commentFilter = 'all'" class="text-xs text-primary font-medium hover:underline pt-1">
                                    Show All Discussions &rarr;
                                </button>
                            </div>
                        </template>
                    </div>

                </div>

            </div>

        </div>
    </section>

</div>

<%- include('../partials/footer') %>
`;

fs.writeFileSync(filePath, newContent, 'utf8');
console.log('✓ Successfully updated src/views/public/copy-trading.ejs with comment session');
